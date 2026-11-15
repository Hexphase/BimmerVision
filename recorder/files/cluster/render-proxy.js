'use strict';
// Local decoder-to-renderer bridge. Frame payloads remain byte-for-byte intact.
var net=require('net'),fs=require('fs');
function message(type,body){var b=Buffer.alloc(body.length+5);b.writeUInt32LE(body.length+1,0);b[4]=type;body.copy(b,5);return b;}
function json(v){return message(74,Buffer.from(JSON.stringify(v)));}
function geometry(view){return {x:view==='right'||view==='rear'?-416:224,y:0,w:1280,h:480};}
function Framer(emit){this.buffer=Buffer.alloc(0);this.emit=emit;}
Framer.prototype.feed=function(chunk){if(this.buffer.length+chunk.length>4194304)throw Error('Preview renderer packet limit');this.buffer=Buffer.concat([this.buffer,chunk]);while(this.buffer.length>=4){var n=this.buffer.readUInt32LE(0);if(n<1||n>4194300)throw Error('Invalid preview renderer packet');if(this.buffer.length<4+n)return;var p=this.buffer.slice(0,4+n);this.buffer=this.buffer.slice(4+n);this.emit(p);}};
function create(socketPath,onError,onFrame,backendPath){
 var view='front',ref=null,layer=null,clients=[],backend=null,generation=0,paused=true,server=net.createServer(function(front){
  if(backend||paused){front.destroy();return;}var epoch=generation,back=net.connect(backendPath||'/dev/shm/cluster-render/render.sock');backend=back;clients.push(front,back);
  function fail(e){front.destroy();back.destroy();if(epoch===generation&&!paused&&backend===back&&onError)onError(e);}
  var parser=new Framer(function(p){
   if(epoch!==generation)return;
   if(p[4]===74){var v=JSON.parse(p.slice(5).toString());if(v.op==='hello'){v.app='bimmervision-cluster-decoder';p=json(v);}if(v.op==='layer'&&v.kind==='video'){ref=v.ref;Object.assign(v,geometry(view),{visible:1,opacity:0,contend:0,prewarm:1,exclusive:0});layer=Object.assign({},v);p=json(v);}else if(v.op==='set'&&v.ref===ref){Object.assign(v,geometry(view),{visible:1,opacity:0,contend:0,prewarm:1,exclusive:0});p=json(v);}}
   if(!back.write(p))front.pause();
   // Native video textures render black on this MGU. Drain their frames but
   // permanently keep opacity zero; the separate RGBA layer is the only image.
   if(p[4]===70&&ref!==null){if(onFrame)onFrame(generation,p,layer);}
  });
  front.on('data',function(b){try{parser.feed(b);}catch(e){fail(e);}});back.on('drain',function(){front.resume();});back.pipe(front);front.on('error',fail);back.on('error',fail);front.on('close',function(){back.destroy();clients=clients.filter(function(s){return s!==front&&s!==back;});if(backend===back)backend=null;});back.on('close',function(){front.destroy();});
 });
 server.on('error',function(e){if(onError)onError(e);});server.listen(socketPath);
 function reset(){paused=true;generation++;clients.forEach(function(s){s.destroy();});clients=[];backend=null;ref=null;layer=null;}
 return {setView:function(next){if(next===view)return;view=next;},reset:reset,resume:function(){paused=false;},close:function(){reset();server.close();try{fs.unlinkSync(socketPath);}catch(e){if(e.code!=='ENOENT')throw e;}}};
}
module.exports={message:message,json:json,geometry:geometry,Framer:Framer,create:create};
