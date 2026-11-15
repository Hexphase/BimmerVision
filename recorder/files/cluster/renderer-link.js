/* SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Hexphase
 *
 * BimmerVision's image-only transport for the published cluster-render v1
 * protocol. The renderer service is installed and maintained separately.
 * This is an original implementation of the wire specification:
 * https://github.com/robertnisipeanu/idrive-apps/blob/main/native/cluster-render/PROTOCOL.md
 */
'use strict';
var net=require('net'),EventEmitter=require('events').EventEmitter;
var MAX_MESSAGE=5529664,MAX_EVENT=65536,CHUNK=65536;
var BOOLEAN_FIELDS=['visible','prewarm','contend','exclusive','guide_hold','yield'];
var NUMBER_FIELDS=['x','y','w','h','z','opacity','rotate','sx','sy','px','py','fps'];
function integer(n,lo,hi){return typeof n==='number'&&isFinite(n)&&Math.floor(n)===n&&n>=lo&&n<=hi;}
function setting(n,fallback,lo,hi){if(n===undefined)return fallback;if(!integer(n,lo,hi))throw Error('Invalid renderer transport limit');return n;}
function fields(input,create){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Image options must be an object');
 var out={};Object.keys(input).forEach(function(key){var value=input[key],wire=key==='klass'?'class':key;
  if(BOOLEAN_FIELDS.indexOf(key)!==-1){if(value!==true&&value!==false&&value!==0&&value!==1)throw Error('Invalid '+key);out[wire]=value?1:0;return;}
  if(NUMBER_FIELDS.indexOf(key)!==-1){if(typeof value!=='number'||!isFinite(value))throw Error('Invalid '+key);if((key==='w'||key==='h')&&value<=0)throw Error('Invalid '+key);if(key==='opacity'&&(value<0||value>1))throw Error('Invalid opacity');if(key==='z'&&(value< -1000||value>1000))throw Error('Invalid z');if(key==='fps'&&(value<0||value>240))throw Error('Invalid fps');out[wire]=value;return;}
  if(wire==='class'){if(['ambient','content','overlay','alert'].indexOf(value)===-1)throw Error('Invalid image class');out[wire]=value;return;}
  if(key==='sampling'){if(value!=='nearest'&&value!=='bilinear')throw Error('Invalid sampling');out[key]=value;return;}
  if(create&&key==='target'){if(typeof value!=='string'||!value.length||value.length>64)throw Error('Invalid target');out[key]=value;return;}
  if(create&&(key==='iw'||key==='ih')){if(!integer(value,1,key==='iw'?1920:720))throw Error('Invalid image size');out[key]=value;return;}
  throw Error('Unsupported image option '+key);
 });return out;
}
function jsonMessage(value){var text=Buffer.from(JSON.stringify(value),'utf8'),wire=Buffer.alloc(text.length+5);wire.writeUInt32LE(text.length+1,0);wire[4]=74;text.copy(wire,5);return {parts:[wire],part:0,offset:0};}
function RendererLink(app,options){
 EventEmitter.call(this);options=options||{};
 if(typeof app!=='string'||!app.length||app.length>128)throw Error('Renderer application name required');
 this.app=app;this.socketPath=options.socketPath||'/dev/shm/cluster-render/render.sock';
 this.retryMinMs=setting(options.retryMinMs,250,1,60000);this.retryMaxMs=setting(options.retryMaxMs,10000,this.retryMinMs,300000);
 this.handshakeTimeoutMs=setting(options.handshakeTimeoutMs,5000,1,300000);
 this.maxRetainedBytes=setting(options.maxRetainedBytes,16*1024*1024,4,64*1024*1024);
 this.ready=false;this._closed=false;this._socket=null;this._retry=null;this._helloTimer=null;this._work=null;
 this._retryDelay=this.retryMinMs;this._layers=new Map();this._drops=new Map();this._reserved=0;this._nextRef=1;this._sequence=0;this._lastFrameRef=0;
 this._active=null;this._blocked=false;this._helloPending=false;this._prefix=Buffer.alloc(4);this._prefixBytes=0;this._body=null;this._bodyBytes=0;
}
require('util').inherits(RendererLink,EventEmitter);
RendererLink.prototype._report=function(error){if(this.listenerCount('error'))this.emit('error',error);};
RendererLink.prototype.image=function(options){
 if(this._closed)throw Error('Renderer link is closed');var config=fields(options,true);
 config.target=config.target||'map';config.iw=config.iw===undefined?config.w:config.iw;config.ih=config.ih===undefined?config.h:config.ih;
 if(!integer(config.iw,1,1920)||!integer(config.ih,1,720))throw Error('Image dimensions iw and ih are required');
 var size=config.iw*config.ih*4;
 if(size+15>MAX_MESSAGE||this._reserved+size>this.maxRetainedBytes)throw Error('Image exceeds retained pixel memory budget');
 if(this._layers.size+this._drops.size>=64||this._nextRef>4294967295)throw Error('Renderer layer limit reached');
 var ref=this._nextRef++;this._reserved+=size;this._layers.set(ref,{ref:ref,config:config,size:size,revision:1,sentRevision:0,announced:false,pixels:null,frame:0,sentFrame:0});this._schedule();return ref;
};
RendererLink.prototype.set=function(ref,patch){
 var layer=this._layers.get(ref);if(this._closed||!layer)return false;var next=fields(patch,false),changed=false;
 Object.keys(next).forEach(function(key){if(layer.config[key]!==next[key]){layer.config[key]=next[key];changed=true;}});
 if(changed){layer.revision++;this._schedule();}return true;
};
// true means an immutable whole image was accepted for transmission, not that
// the cluster displayed it. false never retains this call's pixels. Rectangle
// updates are deliberately outside this client's supported protocol subset.
RendererLink.prototype.pixels=function(ref,rects,pixels){
 var layer=this._layers.get(ref);
 if(this._closed||!this.ready||!layer||(rects!==null&&rects!==undefined&&!(Array.isArray(rects)&&rects.length===0))||!Buffer.isBuffer(pixels)||pixels.length!==layer.size||this._sequence>=9007199254740991)return false;
 layer.pixels=Buffer.from(pixels);layer.frame=++this._sequence;this._schedule();return true;
};
RendererLink.prototype.drop=function(ref){
 var layer=this._layers.get(ref);if(this._closed||!layer)return false;
 this._layers.delete(ref);this._reserved-=layer.size;if(layer.announced&&this._socket)this._drops.set(ref,true);this._schedule();return true;
};
RendererLink.prototype.connect=function(){
 if(this._closed||this._socket||this._retry)return this;
 var self=this,socket=new net.Socket();this._socket=socket;this.ready=false;this._blocked=false;this._active=null;this._helloPending=false;this._prefixBytes=0;this._body=null;this._bodyBytes=0;
 this._layers.forEach(function(layer){layer.announced=false;layer.sentRevision=0;layer.sentFrame=0;});this._drops.clear();
 socket.on('connect',function(){if(self._socket!==socket)return;self._helloPending=true;self._schedule();});
 socket.on('data',function(chunk){if(self._socket===socket)self._receive(chunk);});
 socket.on('drain',function(){if(self._socket===socket){self._blocked=false;self._schedule();}});
 socket.on('error',function(error){if(self._socket===socket)self._fail(error);});
 socket.on('close',function(){if(self._socket!==socket)return;self._socket=null;self.ready=false;self._active=null;self._body=null;self._prefixBytes=0;self._bodyBytes=0;clearTimeout(self._helloTimer);self._helloTimer=null;if(self._work){clearImmediate(self._work);self._work=null;}self.emit('disconnected');self._retryLater();});
 this._helloTimer=setTimeout(function(){if(self._socket===socket)self._fail(Error('Renderer hello handshake timed out'));},this.handshakeTimeoutMs);
 socket.connect(this.socketPath);return this;
};
RendererLink.prototype._retryLater=function(){
 if(this._closed||this._retry)return;var self=this,delay=this._retryDelay;this._retryDelay=Math.min(this.retryMaxMs,delay*2);
 this._retry=setTimeout(function(){self._retry=null;self.connect();},delay);
};
RendererLink.prototype._fail=function(error){this.ready=false;var socket=this._socket;if(socket)socket.destroy();this._report(error);};
RendererLink.prototype._schedule=function(){
 if(this._closed||!this._socket||this._work||this._blocked)return;var self=this;this._work=setImmediate(function(){self._work=null;self._flush();});
};
RendererLink.prototype._select=function(){
 if(this._helloPending){this._helloPending=false;return jsonMessage({op:'hello',app:this.app,proto:1});}
 if(!this.ready)return null;
 var entry=this._drops.keys().next();if(!entry.done){this._drops.delete(entry.value);return jsonMessage({op:'drop',ref:entry.value});}
 var layers=Array.from(this._layers.values()),i,layer,op;
 for(i=0;i<layers.length;i++){layer=layers[i];if(!layer.announced||layer.sentRevision!==layer.revision){op=Object.assign({op:layer.announced?'set':'layer',ref:layer.ref},layer.config);if(!layer.announced)op.kind='image';layer.announced=true;layer.sentRevision=layer.revision;return jsonMessage(op);}}
 // Rotate across layers so a rapidly updated layer cannot starve another.
 var start=0;for(i=0;i<layers.length;i++)if(layers[i].ref===this._lastFrameRef)start=i+1;
 for(i=0;i<layers.length;i++){layer=layers[(start+i)%layers.length];if(!layer.pixels||layer.frame===layer.sentFrame)continue;
  var header=Buffer.alloc(19);header.writeUInt32LE(layer.size+15,0);header[4]=70;header.writeUInt32LE(layer.ref,5);header.writeUInt32LE(layer.frame%4294967296,9);header.writeUInt32LE(Math.floor(layer.frame/4294967296),13);header.writeUInt16LE(0,17);
  layer.sentFrame=layer.frame;this._lastFrameRef=layer.ref;return {parts:[header,layer.pixels],part:0,offset:0};
 }return null;
};
RendererLink.prototype._flush=function(){
 var socket=this._socket;if(this._closed||!socket||socket.destroyed||socket.connecting||this._blocked)return;
 try{while(this._socket===socket&&!socket.destroyed){if(!this._active)this._active=this._select();if(!this._active)return;
   var active=this._active,part=active.parts[active.part],end=Math.min(part.length,active.offset+CHUNK),piece=part.slice(active.offset,end);
   active.offset=end;if(end===part.length){active.part++;active.offset=0;if(active.part===active.parts.length)this._active=null;}
   // Node accepts the entire chunk even when write() returns false. Never
   // retry that chunk; stop here and resume with the next byte after drain.
   if(!socket.write(piece)){this._blocked=true;return;}
  }}catch(error){this._fail(error);}
};
RendererLink.prototype._receive=function(chunk){
 var offset=0;
 try{while(offset<chunk.length&&this._socket&&!this._socket.destroyed){
  if(!this._body){var prefixCount=Math.min(4-this._prefixBytes,chunk.length-offset);chunk.copy(this._prefix,this._prefixBytes,offset,offset+prefixCount);offset+=prefixCount;this._prefixBytes+=prefixCount;if(this._prefixBytes<4)return;
   var size=this._prefix.readUInt32LE(0);this._prefixBytes=0;if(size<2||size>MAX_EVENT)throw Error('Invalid renderer event length');this._body=Buffer.alloc(size);this._bodyBytes=0;
  }
  var count=Math.min(this._body.length-this._bodyBytes,chunk.length-offset);chunk.copy(this._body,this._bodyBytes,offset,offset+count);offset+=count;this._bodyBytes+=count;
  if(this._bodyBytes===this._body.length){var body=this._body;this._body=null;this._bodyBytes=0;if(body[0]!==74)throw Error('Unexpected renderer event type');this._event(JSON.parse(body.toString('utf8',1)));}
 }}catch(error){this._fail(error);}
};
RendererLink.prototype._event=function(event){
 if(!event||typeof event!=='object'||Array.isArray(event))throw Error('Invalid renderer event');var keys=Object.keys(event);
 if(keys.length>64||typeof event.ev!=='string')throw Error('Invalid renderer event fields');
 keys.forEach(function(key){var v=event[key],type=typeof v;if(key.length>64||(type!=='string'&&type!=='number'&&type!=='boolean')||(type==='number'&&!isFinite(v)))throw Error('Renderer event must be flat JSON');});
 if(event.ev==='hello'){
  if(this.ready||event.proto!==1||typeof event.backend!=='string'||typeof event.targets!=='string')throw Error('Unsupported renderer hello protocol');
  clearTimeout(this._helloTimer);this._helloTimer=null;this._retryDelay=this.retryMinMs;this.ready=true;this._schedule();this.emit('ready',event);return;
 }
 if(event.ev==='error'){
  if(typeof event.op!=='string'||typeof event.reason!=='string'||(event.ref!==undefined&&!integer(event.ref,0,4294967295)))throw Error('Invalid renderer refusal');
  this.emit('refused',event.op,event.ref,event.reason);return;
 }
 if(!this.ready)throw Error('Renderer event before hello');
 if(event.ev==='target'){
  if(typeof event.target!=='string'||['idle','acquiring','parked','shown','lingering','waiting','unavailable'].indexOf(event.state)===-1)throw Error('Invalid renderer target event');
  this.emit('target',event.target,event.state,event);
 }
};
RendererLink.prototype.close=function(){
 if(this._closed)return;this._closed=true;this.ready=false;clearTimeout(this._retry);clearTimeout(this._helloTimer);if(this._work)clearImmediate(this._work);
 this._retry=this._helloTimer=this._work=null;var socket=this._socket;this._socket=null;if(socket)socket.destroy();this._active=null;this._body=null;this._layers.clear();this._drops.clear();this._reserved=0;
};
module.exports={RendererLink:RendererLink};
