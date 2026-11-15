'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('net'),fs=require('fs'),os=require('os'),path=require('path');
const root=path.resolve(__dirname,'..');
const Output=require(root+'/recorder/files/cluster/rgba-output').Output;
const RendererLink=require(root+'/recorder/files/cluster/renderer-link').RendererLink;
let now=0,id=0;const timers=new Map(),messages=[];
const clock={now:()=>now,setTimeout:(f,ms)=>{timers.set(++id,{f,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
function tick(ms){const end=now+ms;for(let n=0;n<1000;n++){const next=[...timers].filter(x=>x[1].at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].f();}now=end;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f){for(let i=0;i<100&&!f();i++)await pause(5);assert.ok(f(),'socket condition timed out');}
function json(v){const b=Buffer.from(JSON.stringify(v)),p=Buffer.alloc(b.length+5);p.writeUInt32LE(b.length+1);p[4]=74;b.copy(p,5);return p;}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-output-order-')),socketPath=path.join(dir,'render.sock');let peer;
const server=net.createServer(s=>{peer=s;let pending=Buffer.alloc(0);s.on('data',d=>{pending=Buffer.concat([pending,d]);while(pending.length>=4&&pending.length>=pending.readUInt32LE()+4){const n=pending.readUInt32LE(),m=pending.slice(4,n+4);pending=pending.slice(n+4);if(m[0]===74){const e=JSON.parse(m.slice(1));messages.push(e);if(e.op==='hello')s.write(Buffer.concat([json({ev:'hello',proto:1,backend:'id7',targets:'map:1088x480'}),json({ev:'target',target:'map',state:'shown'})]));}else messages.push({op:'frame',ref:m.readUInt32LE(1),id:m.readUInt32LE(5)});}});});
test('new camera generations cannot make a previous image visible before replacement pixels',async()=>{
 await new Promise(r=>server.listen(socketPath,r));
 const out=new Output(()=>new RendererLink('review',{socketPath}),{},clock);
 const frame=id=>({width:4,height:2,sequence:id,data:Buffer.alloc(12,128)});
 try{
  out.begin(1,()=>out.opacity(1));await until(()=>out.shown);
  out.paintFrame(1,frame(1),'front');tick(100);
  await until(()=>messages.some(m=>m.op==='frame'&&m.ref>3));
  const oldRef=messages.find(m=>m.op==='frame'&&m.ref>3).ref;
  out.end(1);await pause(20);const start=messages.length;
  // Immediate fade callback deterministically models a queued opacity update
  // while writes are pressured or the JS event loop has missed its deadlines.
  out.begin(2,()=>out.opacity(1));out.paintFrame(2,frame(2),'right');tick(100);
  await until(()=>messages.slice(start).some(m=>m.op==='frame'));
  const updates=messages.slice(start);
  assert.equal(updates.some(m=>m.op==='set'&&m.ref===oldRef&&m.visible===1),false,
   'prior camera overlay must not be made visible for a new generation');
 }finally{out.close();if(peer)peer.destroy();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
