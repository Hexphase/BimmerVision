'use strict';
// Record-only transport. No getters, setters, decoding or web-visible telemetry.
var fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process'),io=require('./io');
var definition=require('./perception-schema.json'),transport=require('./perception-transport.json');
var streams=Object.create(null),MAX_LINE=131200;
definition.streams.forEach(function(s){streams[s.serviceId+':'+s.eventId]=s;});
function hex(n){return '0x'+('0000'+n.toString(16)).slice(-4);}
function commands(){
 var groups=Object.create(null);
 definition.streams.forEach(function(s){var key=[s.serviceId,s.instanceId,s.majorVersion,s.eventgroup].join(':');if(!groups[key])groups[key]={source:s,events:[]};groups[key].events.push(s.eventId);});
 return Object.keys(groups).map(function(key){var g=groups[key],s=g.source;return ['sub',hex(s.serviceId),s.instanceId,s.majorVersion,s.eventgroup].concat(g.events.map(hex)).join(' ');});
}
function schemaEvent(){return {type:'perception-schema',schemaVersion:1,encoding:'someip-payload-base64',definitionSha256:crypto.createHash('sha256').update(JSON.stringify(definition)).digest('hex'),definition:definition};}
function Perception(options){
 var o=options||{};this.binary=o.binary||path.join(o.root||__dirname,'perception-receiver');this.spawn=o.spawn||cp.spawn;this.nowUs=o.nowUs||require('./recorder').nowUs;this.nowMs=o.nowMs||Date.now;this.onEvent=o.onEvent||function(){};
 this.child=null;this.starting=false;this.closed=false;this.wanted=false;this.epoch=0;this.nextAttempt=0;this.buffer='';this.bufferedBytes=0;this.discardLine=false;this.seen=Object.create(null);this.stopping=null;
 this.stats={notifications:0,payloadBytes:0,malformedLines:0};
}
Perception.prototype.emit=function(event,atUs){if(this.closed)return;if(atUs==null)atUs=this.nowUs();if(!Number.isSafeInteger(atUs)||atUs<0)return;try{return this.onEvent(event,atUs);}catch(e){return false;}};
Perception.prototype.health=function(state,reason,atUs){return this.emit({type:'perception-status',schemaVersion:1,state:state,reason:String(reason||'').slice(0,240)},atUs);};
Perception.prototype.line=function(line){
 if(this.closed)return;
 if(/^error\b/.test(line)){this.health('transport-error',line);return;}
 var match=/^ev (0x[0-9a-f]+) (0x[0-9a-f]+) ([0-9a-f]*)\s*$/i.exec(line);
 if(!match)return;
 var s=streams[parseInt(match[1],16)+':'+parseInt(match[2],16)];if(!s)return;
 var data=match[3];if(data.length%2||data.length>131072){this.stats.malformedLines++;return;}
 var payload=Buffer.from(data,'hex'),atUs=this.nowUs();
 if(!this.seen[s.serviceId+':'+s.eventId]){this.seen[s.serviceId+':'+s.eventId]=true;this.health('receiving',s.source+'.'+s.signal,atUs);}
 this.stats.notifications++;this.stats.payloadBytes+=payload.length;
 this.emit({type:'perception',schemaVersion:1,serviceId:s.serviceId,instanceId:s.instanceId,majorVersion:s.majorVersion,eventId:s.eventId,source:s.source,signal:s.signal,payloadEncoding:'base64',payload:payload.toString('base64')},atUs);
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
  child.on('error',function(e){if(live()){self.nextAttempt=self.nowMs()+30000;self.health('unavailable',e.message);}});
  child.on('exit',function(code,signal){var unexpected=live();if(self.child===child)self.child=null;if(unexpected){self.nextAttempt=self.nowMs()+30000;self.health('unavailable','Perception transport exited: '+code+' '+(signal||'')+' '+stderr.slice(-160));}});
  child.stdin.on('error',function(e){if(live()){self.health('transport-error',e.message);try{child.kill('SIGTERM');}catch(ignore){}}});
  child.stdin.write(commands().join('\n')+'\n');
  this.health('subscribing','Read-only notification subscriptions requested; no-data is not zero objects');
 }catch(e){if(this.epoch===epoch&&this.wanted&&!this.closed){this.nextAttempt=this.nowMs()+30000;this.health('unavailable',e.message);}}
 finally{this.starting=false;}
};
Perception.prototype.stop=function(){
 this.wanted=false;++this.epoch;this.buffer='';this.bufferedBytes=0;this.discardLine=false;
 if(this.stopping)return this.stopping;
 var child=this.child,self=this;if(!child)return Promise.resolve();
 var resolveStop,done=false,killTimer,limitTimer;
 this.stopping=new Promise(function(resolve){resolveStop=resolve;});
 function finish(){if(done)return;done=true;clearTimeout(killTimer);clearTimeout(limitTimer);self.stopping=null;resolveStop();}
 child.once('exit',finish);
 killTimer=setTimeout(function(){try{child.kill('SIGKILL');}catch(e){}},1000);
 limitTimer=setTimeout(function(){self.health('transport-error','Perception shutdown not confirmed; restart withheld until process exits');finish();},2000);
 try{child.stdin.end();child.kill('SIGTERM');}catch(e){this.health('transport-error',e.message);finish();}
 if(child.exitCode!=null||child.signalCode!=null)finish();
 return this.stopping||Promise.resolve();
};
Perception.prototype.close=async function(){await this.stop();this.closed=true;};
module.exports={Perception:Perception,commands:commands,schemaEvent:schemaEvent};
