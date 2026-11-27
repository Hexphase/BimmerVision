'use strict';
// Isolated native helper sessions for perception, mirror reads and ICAM mode supervision.
var fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process'),io=require('./io');
// perception-transport.json identifies IterioDev's hmictl, shipped as perception-receiver.
var definition=require('./perception-schema.json'),transport=require('./perception-transport.json'),blindSpot=require('./blind-spot'),cameraControl=require('./camera-control'),horn=require('./horn');
var streams=Object.create(null),MAX_LINE=131200;
definition.streams.forEach(function(s){streams[s.serviceId+':'+s.eventId]=s;});
function hex(n){return '0x'+('0000'+n.toString(16)).slice(-4);}
function commands(){
 var groups=Object.create(null);
 definition.streams.forEach(function(s){var key=[s.serviceId,s.instanceId,s.majorVersion,s.eventgroup].join(':');if(!groups[key])groups[key]={source:s,events:[]};groups[key].events.push(s.eventId);});
 return Object.keys(groups).map(function(key){var g=groups[key],s=g.source;return ['sub',hex(s.serviceId),s.instanceId,s.majorVersion,s.eventgroup].concat(g.events.map(hex)).join(' ');});
}
function schemaEvent(){return {type:'perception-schema',schemaVersion:1,encoding:'someip-payload-base64',definitionSha256:crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex'),definition:definition,diagnosticSources:[blindSpot.definition,horn.definition],cameraControlSources:[cameraControl.definition]};}
function Perception(options){
 var o=options||{};this.mirrorOnly=o.mirrorOnly===true;this.cameraOnly=o.cameraOnly===true;if(this.cameraOnly&&this.mirrorOnly)throw Error('Separate camera and mirror sessions required');this.binary=o.binary||path.join(o.root||__dirname,'perception-receiver');this.spawn=o.spawn||cp.spawn;this.nowUs=o.nowUs||require('./recorder').nowUs;this.nowMs=o.nowMs||Date.now;this.onEvent=o.onEvent||function(){};
 this.child=null;this.starting=false;this.closed=false;this.wanted=false;this.epoch=0;this.nextAttempt=0;this.buffer='';this.bufferedBytes=0;this.discardLine=false;this.seen=Object.create(null);this.stopping=null;
 this.stats={notifications:0,payloadBytes:0,malformedLines:0};
 var self=this;this.mirrorTimer=null;this.blindSpot=new blindSpot.BlindSpot({nowMs:this.nowMs,nowUs:this.nowUs,onEvent:function(e,t){self.emit(e,t);if(e.requiresTransportRestart&&self.child){try{self.child.kill('SIGTERM');}catch(ignore){}}}});
 this.horn=new horn.Horn({nowMs:this.nowMs,nowUs:this.nowUs,onEvent:function(e,t){self.emit(e,t);if(e.requiresTransportRestart&&self.child){try{self.child.kill('SIGTERM');}catch(ignore){}}}});
 this.cameraTimer=null;this.camera=new cameraControl.CameraControl({nowMs:this.nowMs,nowUs:this.nowUs,onEvent:function(e,t){self.emit(e,t);}});
}
Perception.prototype.emit=function(event,atUs){if(this.closed)return;if(atUs==null)atUs=this.nowUs();if(!Number.isSafeInteger(atUs)||atUs<0)return;try{return this.onEvent(event,atUs);}catch(e){return false;}};
Perception.prototype.health=function(state,reason,atUs){return this.emit({type:'perception-status',schemaVersion:1,channel:this.cameraOnly?'camera-control':this.mirrorOnly?'blind-spot':'perception',state:state,reason:String(reason||'').slice(0,240)},atUs);};
Perception.prototype.line=function(line){
 if(this.closed)return;
 if(/^error\b/.test(line)){this.health('transport-error',line);return;}
 if(this.cameraOnly){var notice=/^ev 0x3003 0x8009(?:\s+(.*))?$/i.exec(line);if(notice)this.camera.observe(notice[1]||'');else{var state=/^ok ([0-9a-f]{6})\s*$/i.exec(line);if(state)this.camera.observe(state[1]);}return;}
 var match=/^ev (0x[0-9a-f]+) (0x[0-9a-f]+) ([0-9a-f]*)\s*$/i.exec(line);
 if(!match)return;
 if(parseInt(match[1],16)===0xf8a6&&parseInt(match[2],16)===0x8001){if(match[3].length%2===0&&match[3].length<=4096){var reply=Buffer.from(match[3],'hex');if(this.blindSpot.pending!=null)this.blindSpot.receiveProxy(reply);else if(this.horn.pending!=null)this.horn.receiveProxy(reply);}return;}
 var s=streams[parseInt(match[1],16)+':'+parseInt(match[2],16)];if(!s)return;
 var data=match[3];if(data.length%2||data.length>131072){this.stats.malformedLines++;return;}
 var payload=Buffer.from(data,'hex'),atUs=this.nowUs();
 if(!this.seen[s.serviceId+':'+s.eventId]){this.seen[s.serviceId+':'+s.eventId]=true;this.health('receiving',s.source+'.'+s.signal,atUs);}
 this.stats.notifications++;this.stats.payloadBytes+=payload.length;
 this.emit({type:'perception',schemaVersion:1,serviceId:s.serviceId,instanceId:s.instanceId,majorVersion:s.majorVersion,eventId:s.eventId,source:s.source,signal:s.signal,payloadEncoding:'base64',payload:payload.toString('base64')},atUs);
};
// One diagnostic request at a time: replies without a DID (negative responses)
// must belong to exactly one pending reader. Mirror polling retains priority.
Perception.prototype.tickDiagnostics=function(){
 if(this.blindSpot.pending!=null){this.blindSpot.tick();return;}
 if(this.horn.pending!=null){this.horn.tick();return;}
 if(this.blindSpot.send&&this.nowMs()>=this.blindSpot.nextAt)this.blindSpot.tick();else this.horn.tick();
};
Perception.prototype.feed=function(chunk){
 if(this.closed)return;var parts=chunk.toString('ascii').split('\n');
 for(var i=0;i<parts.length;i++){
  var complete=i<parts.length-1;
  if(this.discardLine){if(complete)this.discardLine=false;continue;}
  if(this.buffer.length+parts[i].length>MAX_LINE){this.buffer='';this.discardLine=!complete;this.stats.malformedLines++;this.health('transport-error','Oversized perception line discarded');continue;}
  this.buffer+=parts[i];
  if(complete){var line=this.buffer.replace(/\r$/,'');this.buffer='';this.line(line);}
 }
 this.bufferedBytes=this.buffer.length;
};
Perception.prototype.start=async function(){
 if(this.closed)return;this.wanted=true;
 if(this.child||this.starting||this.stopping||this.nowMs()<this.nextAttempt)return;
 this.starting=true;var epoch=++this.epoch,self=this;
 try{
  var stat=await io.safePath(this.binary,'file');if(stat.size>2097152)throw Error('Invalid perception transport size');
  var bytes=await io.readFile(this.binary);if(crypto.createHash('sha256').update(bytes).digest('hex')!==transport.sha256)throw Error('Perception transport checksum mismatch');
  if(this.closed||!this.wanted||this.epoch!==epoch)return;
  var child=this.spawn(this.binary,['serve'],{stdio:['pipe','pipe','pipe']});this.child=child;this.buffer='';this.bufferedBytes=0;this.discardLine=false;this.seen=Object.create(null);var stderr='';
  function live(){return !self.closed&&self.wanted&&self.epoch===epoch&&self.child===child;}
  child.stdout.on('data',function(b){if(live())self.feed(b);});
  child.stderr.on('data',function(b){if(live())stderr=(stderr+b.toString('utf8')).slice(-2048);});
  function stopMirror(){if(self.mirrorTimer){clearInterval(self.mirrorTimer);self.mirrorTimer=null;}self.blindSpot.stop();self.horn.stop();if(self.cameraTimer){clearInterval(self.cameraTimer);self.cameraTimer=null;}self.camera.stop(false);}
  child.on('error',function(e){if(live()){if(self.mirrorOnly)self.blindSpot.unavailable(e.message);stopMirror();self.nextAttempt=self.nowMs()+30000;self.health('unavailable',e.message);}});
  child.on('exit',function(code,signal){var unexpected=live();if(self.child===child)self.child=null;if(unexpected){if(self.mirrorOnly)self.blindSpot.unavailable('Mirror transport exited');stopMirror();self.nextAttempt=self.nowMs()+30000;self.health('unavailable','Perception transport exited: '+code+' '+(signal||'')+' '+stderr.slice(-160));}});
  child.stdin.on('error',function(e){if(live()){self.health('transport-error',e.message);try{child.kill('SIGTERM');}catch(ignore){}}});
  child.stdin.write((this.cameraOnly?['sub 0x3003 1 1 1 0x8009 0x8014']:this.mirrorOnly?['sub 0xf8a6 128 1 1 0x8001']:commands()).join('\n')+'\n');
  if(this.mirrorOnly){
   var sendDiagnostic=function(command){if(!live())throw Error('BDC transport unavailable');child.stdin.write(command+'\n');};
   this.blindSpot.start(sendDiagnostic);this.horn.start(sendDiagnostic);
   this.tickDiagnostics();this.mirrorTimer=setInterval(function(){if(live())self.tickDiagnostics();},100);
   if(this.mirrorTimer.unref)this.mirrorTimer.unref();
  }
  if(this.cameraOnly){this.camera.start(function(command){if(!live())throw Error('Camera control transport unavailable');child.stdin.write(command+'\n');});this.camera.tick();this.cameraTimer=setInterval(function(){if(live())self.camera.tick();},500);if(this.cameraTimer.unref)this.cameraTimer.unref();}
  this.health('subscribing',this.cameraOnly?'Native ICAM state supervision requested':this.mirrorOnly?'Read-only BDC mirror and horn reads requested; missing data is not OFF':'Read-only perception subscriptions requested; missing data is not zero detections');
 }catch(e){if(this.epoch===epoch&&this.wanted&&!this.closed){this.nextAttempt=this.nowMs()+30000;this.health('unavailable',e.message);}}
 finally{this.starting=false;}
};
Perception.prototype.stop=function(){
 var released=this.cameraOnly&&this.camera.stop();if(this.cameraTimer){clearInterval(this.cameraTimer);this.cameraTimer=null;}
 if(this.mirrorTimer){clearInterval(this.mirrorTimer);this.mirrorTimer=null;}this.blindSpot.stop();this.horn.stop();
 this.wanted=false;++this.epoch;this.buffer='';this.bufferedBytes=0;this.discardLine=false;
 if(this.stopping)return this.stopping;
 var child=this.child,self=this;if(!child)return Promise.resolve();
 var resolveStop,done=false,killTimer,limitTimer,releaseTimer;
 this.stopping=new Promise(function(resolve){resolveStop=resolve;});
 function finish(){if(done)return;done=true;clearTimeout(killTimer);clearTimeout(limitTimer);clearTimeout(releaseTimer);self.stopping=null;resolveStop();}
 child.once('exit',finish);
 killTimer=setTimeout(function(){try{child.kill('SIGKILL');}catch(e){}},1000);
 limitTimer=setTimeout(function(){self.health('transport-error','Perception shutdown not confirmed; restart withheld until process exits');finish();},2000);
 function terminate(){try{child.stdin.end();child.kill('SIGTERM');}catch(e){self.health('transport-error',e.message);finish();}}
 if(released)releaseTimer=setTimeout(terminate,300);else terminate();
 if(child.exitCode!=null||child.signalCode!=null)finish();
 return this.stopping||Promise.resolve();
};
Perception.prototype.close=async function(){await this.stop();this.closed=true;};
module.exports={Perception:Perception,commands:commands,schemaEvent:schemaEvent};
