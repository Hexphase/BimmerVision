'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const Controller = require('../recorder/files/cluster/controller').Controller;
function harness() {
 let now=0, id=0, tasks=new Map(), live=0, maximum=0, calls=[], frames=[], opacity=[];
 const clock={now:()=>now,setTimeout:(fn,ms)=>{tasks.set(++id,{at:now+ms,fn});return id;},clearTimeout:i=>tasks.delete(i)};
 const adapter={start:async(view,g,frame)=>{live++;maximum=Math.max(maximum,live);calls.push(['start',view,g]);frames.push(frame);return {view,g};},stop:async s=>{calls.push(['stop',s.view]);live--;},release:()=>calls.push(['release']),opacity:v=>opacity.push(v),status:s=>calls.push(['status',s])};
 const controller=new Controller(adapter,clock);
 async function tick(ms){const end=now+ms;for(let n=0;n<10000;n++){const next=Array.from(tasks.entries()).filter(x=>x[1].at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();await Promise.resolve();await Promise.resolve();}now=end;await Promise.resolve();await Promise.resolve();}
 return {controller,adapter,clock,tick,calls,frames,opacity,tasks,get maximum(){return maximum;},get live(){return live;}};
}
test('latest view settles once across 1000 rapid changes and stops before replacement',async()=>{
 const h=harness();for(let i=0;i<1000;i++)h.controller.view(i%2?'left':'right');
 await h.tick(149);assert.equal(h.live,0);await h.tick(1);assert.equal(h.live,1);assert.equal(h.calls.find(x=>x[0]==='start')[1],'left');
 h.controller.view('front');await h.tick(150);assert.equal(h.maximum,1);assert.deepEqual(h.calls.filter(x=>x[0]==='start').map(x=>x[1]),['left','front']);await h.controller.close();assert.equal(h.live,0);assert.equal(h.tasks.size,0);
});
test('cancelled fade and stale frame callbacks cannot reveal an old camera',async()=>{
 const h=harness();h.controller.view('front');await h.tick(150);h.frames[0]();await h.tick(180);assert.equal(h.opacity.at(-1),1);
 h.controller.view('left');await h.tick(50);h.controller.view('right');h.frames[0]();await h.tick(150);assert.equal(h.opacity.at(-1),0);
 h.frames[0]();await h.tick(180);assert.equal(h.opacity.at(-1),0);h.frames[1]();await h.tick(180);assert.equal(h.opacity.at(-1),1);await h.controller.close();
});
test('null view fully releases the target and decode then resumes fresh',async()=>{
 const h=harness();h.controller.view('left');await h.tick(150);h.frames[0]();await h.tick(180);h.controller.view(null);await h.tick(150);
 assert.equal(h.live,0);assert.ok(h.calls.some(x=>x[0]==='release'));h.controller.view('right');await h.tick(150);assert.equal(h.live,1);assert.equal(h.opacity.at(-1),0);await h.controller.close();
});
test('shutdown awaits a pending startup and cannot leave a late session alive',async()=>{
 const h=harness();let resolve;h.adapter.start=()=>new Promise(r=>{resolve=r;});let stops=0;h.adapter.stop=async()=>{stops++;};
 h.controller.view('front');await h.tick(150);const closing=h.controller.close();resolve({view:'front'});await closing;assert.equal(stops,1);assert.equal(h.tasks.size,0);
});
test('FIFO without native reader is bounded and closes without waiting for acquisition',()=>{
 const Writer=require('../recorder/files/cluster/fifo-writer').Writer;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-worker-test-')),file=path.join(dir,'stream');cp.execFileSync('mkfifo',[file]);
 try {const writer=new Writer(file);writer.on('error',e=>{throw e;});writer.write(Buffer.alloc(2*1024*1024));assert.ok(writer.pending);assert.equal(writer.write(Buffer.alloc(1024)),false);writer.end();assert.equal(writer.pending,null);assert.equal(writer.timer,null);assert.throws(()=>fs.fstatSync(writer.fd),{code:'EBADF'});}finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
});
function rtp(seq,payload,ssrc=7){const b=Buffer.alloc(12+payload.length);b[0]=128;b[1]=224;b.writeUInt16BE(seq,2);b.writeUInt32BE(seq,4);b.writeUInt32BE(ssrc,8);payload.copy(b,12);return b;}
test('midstream parameter seed preserves actual sequence and requires sync after resync',()=>{
 const Pipeline=require('../recorder/files/cluster/input').Input,units=[],input=new Pipeline(u=>units.push(u));
 input.parameters([{ssrc:7,sps:Buffer.from([103,1]).toString('base64'),pps:Buffer.from([104,2]).toString('base64')}]);
 input.packet(rtp(48321,Buffer.from([65,0xC0])),1);assert.equal(units.length,0);
 input.packet(rtp(48322,Buffer.from([101,0x80])),2);assert.equal(units.length,1);assert.equal(units[0].sps[0],103);
 input.resync();input.packet(rtp(50001,Buffer.from([65,0xC0])),3);assert.equal(units.length,1);input.packet(rtp(50002,Buffer.from([101,0x80])),4);assert.equal(units.length,2);
 assert.throws(()=>input.parameters(new Array(9).fill({})),/limit/);assert.throws(()=>input.parameters([{ssrc:7,sps:Buffer.alloc(65537,103).toString('base64'),pps:'aAI='}]),/parameter/);
});
test('native renderer pixels drain with permanently invisible YUV and stale sockets isolated',async t=>{
 const net=require('net'),once=require('events').once,P=require('../recorder/files/cluster/render-proxy');
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bv-proxy-')),backendPath=path.join(dir,'back'),socket=path.join(dir,'front'),received=[],frames=[];
 const sockets=[];const server=net.createServer(s=>{sockets.push(s);const f=new P.Framer(p=>received.push(p));s.on('data',b=>f.feed(b));});server.listen(backendPath);await once(server,'listening');
 const proxy=P.create(socket,e=>{throw e;},g=>frames.push(g),backendPath);let front;
 t.after(async()=>{if(front)front.destroy();proxy.close();sockets.forEach(s=>s.destroy());await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 async function until(f){for(let i=0;!f();i++){if(i>500)throw Error('socket timeout');await new Promise(r=>setTimeout(r,2));}}
 proxy.resume();front=net.connect(socket);await once(front,'connect');front.write(Buffer.concat([P.json({op:'hello',app:'native'}),P.json({op:'layer',kind:'video',ref:1,vw:4,vh:2,visible:1}),P.json({op:'set',ref:1,visible:1,opacity:1}),P.message(70,Buffer.alloc(14))]));await until(()=>frames.length===1);
 assert.ok(received.filter(p=>p[4]===74).map(p=>JSON.parse(p.slice(5))).filter(p=>p.kind==='video'||p.op==='set').every(p=>p.opacity===0));
 proxy.reset();await until(()=>front.destroyed);assert.throws(()=>new P.Framer(()=>{}).feed(Buffer.from([255,255,255,127])),/Invalid/);
});
test('worker stops cleanly through IPC and parent disconnect before map acquisition',async()=>{
 const worker=path.join(__dirname,'../recorder/files/cluster/worker.js');
 for(const disconnect of [false,true]){const child=cp.fork(worker,[],{stdio:['pipe','pipe','pipe','ipc']});let errors='';child.stderr.on('data',b=>errors+=b);await new Promise(r=>child.once('spawn',r));if(disconnect)child.disconnect();else child.send({type:'stop'});const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('worker shutdown timeout '+errors));},2000);child.on('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal});});});assert.deepEqual(result,{code:0,signal:null});}
});
test('renderer suspension cancels an in-flight fade until a newly acquired fresh frame',async()=>{
 const h=harness();h.controller.view('front');await h.tick(150);h.frames[0]();await h.tick(40);h.controller.suspend();await h.tick(200);assert.equal(h.opacity.at(-1),0);h.frames[0]();await h.tick(180);assert.equal(h.opacity.at(-1),1);await h.controller.close();
});
test('native process group cleanup kills and awaits a child that ignores graceful termination',async()=>{
 const endChild=require('../recorder/files/cluster/process').endChild;
 const child=cp.spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['pipe','pipe','pipe']});
 await new Promise(r=>child.stdout.once('data',r));const at=Date.now();await endChild(child);assert.ok(child.exitCode!==null||child.signalCode!==null);assert.ok(Date.now()-at<2000);assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
});
test('failed native startup removes its FIFO and private directory',async()=>{
 if(process.platform==='linux')return; // This fixture exercises the Linux decoder candidate cannot execute on macOS.
 const before=new Set(fs.readdirSync('/tmp').filter(n=>n.indexOf('bv-decoder-')===0));
 const child=cp.fork(path.join(__dirname,'../recorder/files/cluster/worker.js'),[],{stdio:['pipe','pipe','pipe','ipc']}),states=[];let stderr='';child.stderr.on('data',b=>stderr+=b);child.on('message',m=>states.push(m));child.send({type:'view',view:'front'});
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('native failure cleanup timeout'));},3000);child.on('exit',c=>{clearTimeout(timer);resolve(c);});});
 assert.equal(code,1);assert.match(stderr,/BimmerVision decoder:/);assert.ok(states.some(s=>s.type==='status'&&s.state==='error'));assert.deepEqual(fs.readdirSync('/tmp').filter(n=>n.indexOf('bv-decoder-')===0&&!before.has(n)),[]);
});
test('RGBA renderer crops the requested atlas half and preserves original decoded bytes',()=>{
 const convert=require('../recorder/files/cluster/atlas-rgba').convert,p=Buffer.alloc(31);p[4]=70;Buffer.from([76,76,150,150,76,76,150,150,85,44,255,21]).copy(p,19);const before=Buffer.from(p);
 assert.deepEqual(Array.from(convert(p,{vw:4,vh:2},'left').pixels.slice(0,4)),[254,0,0,255]);assert.deepEqual(Array.from(convert(p,{vw:4,vh:2},'right').pixels.slice(0,4)),[0,255,1,255]);assert.deepEqual(p,before);assert.throws(()=>convert(p.slice(1),{vw:4,vh:2},'front'),/complete/);
});
test('native namespace creates its own plain mount target and rejects symlinks',()=>{
 const ensure=require('../recorder/files/cluster/namespace').ensureTarget,dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-mount-')),target=path.join(dir,'camcluster');
 try{assert.equal(ensure(target),true);assert.equal(ensure(target),false);fs.rmdirSync(target);fs.writeFileSync(target,'x');assert.throws(()=>ensure(target),/plain directory/);fs.unlinkSync(target);fs.symlinkSync(dir,target);assert.throws(()=>ensure(target),/plain directory/);}finally{fs.unlinkSync(target);fs.rmdirSync(dir);}
});
function rendererHarness(clock){
 const EventEmitter=require('events');let clients=[];
 class Client extends EventEmitter{constructor(){super();this.layers=new Map();this.next=0;this.closes=0;this.pixelFrames=0;clients.push(this);}image(opts){const ref=++this.next;this.layers.set(ref,Object.assign({},opts));return ref;}pixels(ref,rects,pixels){if(pixels.length>4)this.pixelFrames++;return true;}set(ref,opts){Object.assign(this.layers.get(ref),opts);}drop(ref){this.layers.delete(ref);}connect(){}close(){this.closes++;this.layers.clear();}}
 const Renderer=require('../recorder/files/cluster/renderer').Renderer,renderer=new Renderer(()=>new Client(),{},clock);
 return {renderer,clients};
}
function atlasFrame(id){const p=Buffer.alloc(31);p[4]=70;p.writeUInt32LE(id||0,9);Buffer.from([76,76,150,150,76,76,150,150,85,44,255,21]).copy(p,19);return p;}
test('timed renderer commits every upstream frame once across99/101ms arrival jitter',async()=>{
 const c=harness(),h=rendererHarness(c.clock),r=h.renderer;let committed=0;r.begin(1,()=>committed++);h.clients[0].emit('target','map','shown');
 for(let n=0;n<100;n++){await c.tick(n%2?101:99);assert.equal(r.paint(1,atlasFrame(n+1),{vw:4,vh:2},'front'),true);}
 await c.tick(200);assert.equal(h.clients[0].pixelFrames,100);assert.equal(committed,100);r.close();assert.equal(c.tasks.size,0);
});
test('map ownership survives switches while fresh timed commits alone trigger fade-in',async()=>{
 const c=harness(),h=rendererHarness(c.clock),r=h.renderer;c.adapter.start=async(view,g,frame)=>{r.begin(g,frame);return {view,g,frame};};c.adapter.stop=async s=>r.end(s.g);c.adapter.release=()=>r.close();c.adapter.opacity=value=>r.opacity(value);
 c.controller.view('front');await c.tick(150);h.clients[0].emit('target','map','shown');const first=c.controller.session;assert.equal(r.paint(first.g,atlasFrame(1),{vw:4,vh:2},'front'),true);await c.tick(99);assert.equal(h.clients[0].pixelFrames,0);assert.equal(c.controller.ready,false);await c.tick(1);assert.equal(h.clients[0].pixelFrames,1);assert.equal(c.controller.ready,true);await c.tick(180);assert.equal(c.controller.opacity,1);
 c.controller.view('left');await c.tick(150);assert.equal(h.clients.length,1);assert.equal(h.clients[0].closes,0);assert.equal(c.controller.opacity,0);assert.ok(Array.from(h.clients[0].layers.values()).some(l=>l.klass==='content'&&l.visible));
 assert.equal(r.paint(first.g,atlasFrame(2),{vw:4,vh:2},'front'),false);const next=c.controller.session;assert.equal(r.paint(next.g,atlasFrame(3),{vw:4,vh:2},'left'),true);await c.tick(99);assert.equal(h.clients[0].pixelFrames,1);assert.equal(c.controller.ready,false);await c.tick(181);assert.equal(h.clients[0].pixelFrames,2);assert.equal(c.controller.opacity,1);
 c.controller.view(null);await c.tick(150);assert.equal(h.clients[0].closes,1);assert.equal(h.clients[0].layers.size,0);assert.equal(c.tasks.size,0);c.controller.view('right');await c.tick(150);assert.equal(h.clients.length,2);await c.controller.close();assert.equal(h.clients[1].closes,1);assert.equal(c.tasks.size,0);
});
test('RTP resync inside an AU callback preserves a partial CAMP frame across stdin chunks',()=>{
 const Input=require('../recorder/files/cluster/input').Input,got=[];let input=new Input(u=>{got.push(u.rtpTimestamp);if(got.length===1)input.resync();});input.parameters([{ssrc:7,sps:'ZwE=',pps:'aAI='}]);
 function camp(seq){const raw=rtp(seq,Buffer.from([101,128])),b=Buffer.alloc(raw.length+8);b.write('CAMP');b.writeUInt32LE(raw.length,4);raw.copy(b,8);return b;}
 const one=camp(1),two=camp(2);input.push(Buffer.concat([one,two.slice(0,13)]),1);input.push(two.slice(13),2);assert.deepEqual(got,[1,2]);
});
function feedUnit(id,view,sync){const prefix=Buffer.from('060525b62c66633562426cfb625ef145d3415301','hex');return {idr:sync,sps:Buffer.from([103,1]),pps:Buffer.from([104,2]),nals:[Buffer.concat([prefix,Buffer.from([50,50,view==='front'?9:10,0])]),Buffer.from([sync?101:65,sync?128:192,id])]};}
function blockedWriter(){const EventEmitter=require('events');const w=new EventEmitter();w.pending=null;w.writes=[];w.write=function(b){assert.equal(this.pending,null,'access units must never interleave');this.pending=b;this.writes.push(Buffer.from(b));return false;};w.finish=function(){this.pending=null;this.emit('drain');};return w;}
test('FIFO feeder filters the other camera before pressure and keeps only newest safe selected AU',()=>{
 const Feeder=require('../recorder/files/cluster/frame-feeder').Feeder,w=blockedWriter(),f=new Feeder(w,'front');
 assert.equal(f.push(feedUnit(1,'front',true)),'written');assert.equal(f.push(feedUnit(2,'left',true)),'ignored');assert.equal(f.latest,null);
 assert.equal(f.push(feedUnit(3,'front',false)),'queued');assert.equal(f.push(feedUnit(4,'front',false)),'waiting-sync');assert.equal(f.latest,null);assert.equal(f.push(feedUnit(5,'front',false)),'waiting-sync');w.finish();
 assert.equal(f.push(feedUnit(6,'front',true)),'written');assert.equal(f.push(feedUnit(7,'front',true)),'queued');assert.equal(f.push(feedUnit(8,'front',true)),'replaced');assert.ok(f.latest.length<=8388608);w.finish();w.finish();assert.deepEqual(w.writes.map(b=>b[b.length-1]),[1,6,8]);f.close();
});
test('FIFO feeder waits initial sync and removes generation drain callbacks during cleanup',()=>{
 const Feeder=require('../recorder/files/cluster/frame-feeder').Feeder,w=blockedWriter(),f=new Feeder(w,'front');assert.equal(f.push(feedUnit(1,'front',false)),'waiting-sync');f.push(feedUnit(2,'front',true));f.push(feedUnit(3,'front',true));f.close();w.finish();assert.equal(w.writes.length,1);assert.equal(w.listenerCount('drain'),0);assert.equal(f.latest,null);assert.equal(f.push(feedUnit(4,'front',true)),'closed');
});
test('explicit session transport reset clears an old partial CAMP packet without losing cached parameters',()=>{
 const Input=require('../recorder/files/cluster/input').Input,got=[],input=new Input(u=>got.push(u.rtpTimestamp));input.parameters([{ssrc:7,sps:'ZwE=',pps:'aAI='}]);
 function camp(seq){const raw=rtp(seq,Buffer.from([101,128])),b=Buffer.alloc(raw.length+8);b.write('CAMP');b.writeUInt32LE(raw.length,4);raw.copy(b,8);return b;}
 input.push(camp(1).slice(0,13),1);input.resetTransport();input.push(camp(2),2);assert.deepEqual(got,[2]);
});
