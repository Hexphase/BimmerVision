'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const net=require('net'),fs=require('fs'),os=require('os'),path=require('path');
const RendererLink=require('../recorder/files/cluster/renderer-link').RendererLink;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<400;i++){if(fn())return;await pause(5);}throw Error('timed out waiting for socket behavior');}
function json(value){const body=Buffer.from(JSON.stringify(value)),wire=Buffer.alloc(5+body.length);wire.writeUInt32LE(body.length+1);wire[4]=74;body.copy(wire,5);return wire;}
async function fixture(t,options){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-link-')),socketPath=path.join(dir,'render.sock'),sessions=[];
 const server=net.createServer(socket=>{const session={socket,messages:[],pending:Buffer.alloc(0)};sessions.push(session);socket.on('error',()=>{});socket.on('data',chunk=>{session.pending=Buffer.concat([session.pending,chunk]);while(session.pending.length>=4){const size=session.pending.readUInt32LE(0);assert.ok(size>0&&size<=5529664);if(session.pending.length<size+4)break;const frame=session.pending.slice(4,size+4);session.pending=session.pending.slice(size+4);session.messages.push(frame[0]===74?JSON.parse(frame.slice(1)): {type:'F',ref:frame.readUInt32LE(1),id:frame.readUInt32LE(5)+4294967296*frame.readUInt32LE(9),rects:frame.readUInt16LE(13),pixels:Buffer.from(frame.slice(15))});}});});
 await new Promise(resolve=>server.listen(socketPath,resolve));
 const link=new RendererLink('test-bimmervision',Object.assign({socketPath,retryMinMs:10,retryMaxMs:30,handshakeTimeoutMs:200},options));const errors=[];link.on('error',e=>errors.push(e));
 t.after(async()=>{link.close();sessions.forEach(s=>s.socket.destroy());await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 async function hello(index,fragment){await until(()=>sessions[index]&&sessions[index].messages.length);const s=sessions[index];assert.deepEqual(s.messages[0],{op:'hello',app:'test-bimmervision',proto:1});const wire=json({ev:'hello',proto:1,backend:'id7',targets:'map:1088x480,panel:1920x720,hud:800x480',repeat:1});if(fragment){for(let offset=0;offset<wire.length;offset+=3){s.socket.write(wire.slice(offset,offset+3));await pause(1);}}else s.socket.write(wire);await until(()=>link.ready);return s;}
 return {link,sessions,hello,errors};
}
test('negotiates fragmented hello and encodes image options, events and whole RGBA frames',async t=>{
 const f=await fixture(t),link=f.link,events=[];link.on('target',(target,state)=>events.push([target,state]));link.on('refused',(op,ref,reason)=>events.push([op,ref,reason]));
 const ref=link.image({target:'map',klass:'overlay',x:224,y:0,w:640,h:480,iw:1,ih:1,fps:15,prewarm:true,visible:false,contend:true,opacity:0,z:300});assert.equal(link.pixels(ref,null,Buffer.from([9,9,9,9])),false);link.connect();const s=await f.hello(0,true);
 assert.equal(link.pixels(ref,null,Buffer.from([1,2,3,255])),true);link.set(ref,{visible:true,opacity:0.5});await until(()=>s.messages.some(m=>m.type==='F')&&s.messages.some(m=>m.op==='set'));
 const layer=s.messages.find(m=>m.op==='layer');assert.equal(layer.ref,ref);assert.equal(layer.kind,'image');assert.equal(layer.class,'overlay');assert.equal(layer.prewarm,1);assert.equal(layer.visible,0);assert.equal(layer.iw,1);assert.equal(layer.ih,1);assert.equal(layer.klass,undefined);
 const frame=s.messages.find(m=>m.type==='F');assert.equal(frame.ref,ref);assert.equal(frame.id,1);assert.equal(frame.rects,0);assert.deepEqual(frame.pixels,Buffer.from([1,2,3,255]));
 s.socket.write(Buffer.concat([json({ev:'target',target:'map',state:'shown',holder:'',reason:'',retry_in_ms:0,rendering:'verified',guide_disabled:0,disabled:0}),json({ev:'error',op:'set',ref,reason:'test refusal'})]));await until(()=>events.length===2);assert.deepEqual(events,[['map','shown'],['set',ref,'test refusal']]);
 link.drop(ref);await until(()=>s.messages.some(m=>m.op==='drop'&&m.ref===ref));assert.equal(link.pixels(ref,null,Buffer.from([1,2,3,4])),false);
});
test('reconnect recreates current layers with latest retained immutable pixels and increasing IDs',async t=>{
 const f=await fixture(t),link=f.link;const ref=link.image({target:'map',iw:1,ih:1});link.connect();const first=await f.hello(0);const pixels=Buffer.from([8,7,6,255]);assert.equal(link.pixels(ref,null,pixels),true);pixels.fill(0);link.set(ref,{opacity:0.75});await until(()=>first.messages.some(m=>m.type==='F'));first.socket.destroy();await until(()=>!link.ready);assert.equal(link.pixels(ref,null,Buffer.from([2,2,2,2])),false);
 const second=await f.hello(1);await until(()=>second.messages.some(m=>m.type==='F'));assert.equal(second.messages.find(m=>m.op==='layer').opacity,0.75);const restored=second.messages.find(m=>m.type==='F');assert.deepEqual(restored.pixels,Buffer.from([8,7,6,255]));assert.equal(restored.id,1);assert.equal(link.pixels(ref,null,Buffer.from([1,1,1,255])),true);await until(()=>second.messages.filter(m=>m.type==='F').length===2);assert.deepEqual(second.messages.filter(m=>m.type==='F').map(m=>m.id),[1,2]);
});
test('coalesces whole frames under a paused real socket without interleaving or reordering',async t=>{
 const f=await fixture(t),link=f.link,ref=link.image({target:'map',iw:1024,ih:720});link.connect();const s=await f.hello(0);s.socket.pause();assert.equal(link.pixels(ref,null,Buffer.alloc(1024*720*4,1)),true);await pause(25);let accepted=1;for(let n=2;n<=80;n++){const frame=Buffer.alloc(1024*720*4,n);assert.equal(link.pixels(ref,null,frame),true);accepted++;}s.socket.resume();await until(()=>s.messages.some(m=>m.type==='F'&&m.id===accepted));const frames=s.messages.filter(m=>m.type==='F');assert.ok(frames.length<10,'replaced pending images must not build a write queue');assert.equal(frames[0].id,1,'the started image must finish before replacement');for(let n=0;n<frames.length;n++){assert.equal(frames[n].pixels.length,1024*720*4);assert.ok(frames[n].pixels.every(v=>v===frames[n].id));if(n)assert.ok(frames[n].id>frames[n-1].id);}assert.equal(frames[frames.length-1].id,80);
});
test('rejects unsupported pixels and bounds retained images without storing rejected calls',async t=>{
 const f=await fixture(t,{maxRetainedBytes:8}),link=f.link,ref=link.image({target:'map',iw:1,ih:1});link.connect();const s=await f.hello(0);assert.equal(link.pixels(ref,[{x:0,y:0,w:1,h:1}],Buffer.alloc(4)),false);assert.equal(link.pixels(ref,null,Buffer.alloc(3)),false);assert.equal(link.pixels(ref,null,Buffer.alloc(4,5)),true);assert.throws(()=>link.image({target:'map',iw:2,ih:1}),/memory|retain|budget/i);await until(()=>s.messages.some(m=>m.type==='F'));assert.equal(s.messages.filter(m=>m.type==='F').length,1);assert.equal(s.messages.find(m=>m.type==='F').id,1);
});
test('malformed and oversized inbound messages disconnect, never emit ready, and retry safely',async t=>{
 for(const invalid of [Buffer.from([0,0,0,0]),Buffer.from([255,255,255,127]),Buffer.from([2,0,0,0,70,0]),json({ev:'hello',proto:2}),json({ev:'target',target:'map',state:{nested:'bad'}})]){
  const f=await fixture(t),link=f.link;let ready=0;link.on('ready',()=>ready++);link.connect();await until(()=>f.sessions.length&&f.sessions[0].messages.length);f.sessions[0].socket.write(invalid);await until(()=>f.errors.length>0);assert.equal(ready,0);link.close();await pause(40);assert.equal(f.sessions.length,1);
 }
});
test('close cancels handshake timers and retries, releases socket, and cannot reconnect',async t=>{
 const f=await fixture(t,{handshakeTimeoutMs:25}),link=f.link;link.connect();await until(()=>f.sessions.length===1);link.close();link.connect();await pause(80);assert.equal(f.sessions.length,1);assert.equal(link.ready,false);assert.equal(f.sessions[0].socket.destroyed,true);assert.equal(f.errors.length,0);
});
test('handshake timeout retries with one connection attempt at a time',async t=>{
 const f=await fixture(t,{handshakeTimeoutMs:20}),link=f.link;link.connect();link.connect();await until(()=>f.sessions.length>=3);link.close();const count=f.sessions.length;await pause(70);assert.equal(f.sessions.length,count);assert.ok(f.errors.some(e=>/hello|handshake/i.test(e.message)));
});

test('disconnect during a partial image restores only the latest complete retained image',async t=>{
 const f=await fixture(t),link=f.link,ref=link.image({target:'map',iw:1024,ih:720});link.connect();const first=await f.hello(0);first.socket.pause();assert.equal(link.pixels(ref,null,Buffer.alloc(1024*720*4,11)),true);await pause(20);assert.equal(link.pixels(ref,null,Buffer.alloc(1024*720*4,22)),true);first.socket.destroy();const second=await f.hello(1);await until(()=>second.messages.some(m=>m.type==='F'));const frames=second.messages.filter(m=>m.type==='F');assert.equal(frames.length,1);assert.equal(frames[0].id,2);assert.ok(frames[0].pixels.every(value=>value===22));assert.equal(second.pending.length,0);
});
test('dropping a layer during a partial write finishes framing before its drop and never restores it',async t=>{
 const f=await fixture(t),link=f.link,ref=link.image({target:'map',iw:1024,ih:720});link.connect();const first=await f.hello(0);first.socket.pause();assert.equal(link.pixels(ref,null,Buffer.alloc(1024*720*4,33)),true);await pause(20);assert.equal(link.drop(ref),true);first.socket.resume();await until(()=>first.messages.some(m=>m.op==='drop'));const ops=first.messages.map(m=>m.type||m.op);assert.ok(ops.indexOf('F')<ops.indexOf('drop'));assert.ok(first.messages.find(m=>m.type==='F').pixels.every(value=>value===33));first.socket.destroy();const second=await f.hello(1);await pause(25);assert.deepEqual(second.messages.map(m=>m.type||m.op),['hello']);
});
