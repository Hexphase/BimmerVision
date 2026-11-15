'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),EventEmitter=require('events');
const Pacer=require('../recorder/files/cluster/pacer').Pacer;
function clock(){let now=0,id=0,tasks=new Map();return {now:()=>now,setTimeout:(fn,ms)=>{tasks.set(++id,{fn,at:now+ms});return id;},clearTimeout:i=>tasks.delete(i),advance(ms){const end=now+ms;for(let n=0;n<10000;n++){let next=Array.from(tasks.entries()).filter(x=>x[1].at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=Math.max(now,next[1].at);tasks.delete(next[0]);next[1].fn();}now=Math.max(now,end);},stall(ms){now+=ms;},get count(){return tasks.size;}};}
test('100ms buffer absorbs arrival jitter into absolute15Hz fresh-frame commits',()=>{
 const c=clock(),out=[],p=new Pacer(frame=>{out.push({id:frame.id,at:c.now(),age:c.now()-frame.receivedAt});return true;},c);p.begin(1);
 const arrivals=[0,73,126,212,264,334,407,462,536,601,670,731,805,864,940];arrivals.forEach((at,n)=>c.setTimeout(()=>p.enqueue(1,{id:n+1}),at));c.advance(1000);assert.equal(out[0].at,100);assert.ok(out.length>=13);for(let i=1;i<out.length;i++)assert.ok(Math.abs(out[i].at-out[i-1].at-1000/15)<1.001);assert.ok(out.every(x=>x.age<=150));assert.equal(new Set(out.map(x=>x.id)).size,out.length);p.close();assert.equal(c.count,0);
});
test('queue bounds discard oldest complete frames and never invent duplicate commits',()=>{
 const c=clock(),out=[],p=new Pacer(frame=>{out.push(frame.id);return true;},c);p.begin(1);for(let id=1;id<=1000;id++){p.enqueue(1,{id});assert.ok(p.queue.length<=2);}assert.equal(p.enqueue(1,{id:1000}),false);c.advance(100);assert.deepEqual(out,[999]);c.advance(20);p.enqueue(1,{id:1001});c.advance(100);assert.deepEqual(out,[999,1001]);c.advance(500);assert.deepEqual(out,[999,1001]);p.close();
});
test('timer stalls skip stale content and missed deadlines without a catch-up burst',()=>{
 const c=clock(),out=[],p=new Pacer(frame=>{out.push({id:frame.id,at:c.now()});return true;},c);p.begin(1);p.enqueue(1,{id:1});c.advance(67);p.enqueue(1,{id:2});c.stall(400);c.advance(0);assert.deepEqual(out,[]);p.enqueue(1,{id:3});p.enqueue(1,{id:4});c.advance(66);assert.ok(out.length<=1);c.advance(67);assert.equal(out.length,2);assert.ok(out[1].at-out[0].at>=66);p.close();
});
test('generation end and suspension cancel queued frames and all timers',()=>{
 const c=clock(),out=[],p=new Pacer(frame=>{out.push(frame.id);return true;},c);p.begin(1);p.enqueue(1,{id:1});p.end(1);assert.equal(p.queue.length,0);assert.equal(c.count,0);p.begin(2);assert.equal(p.enqueue(1,{id:2}),false);p.enqueue(2,{id:3});p.suspend();c.advance(500);assert.deepEqual(out,[]);assert.equal(c.count,0);p.begin(2);p.enqueue(2,{id:4});p.close();c.advance(500);assert.deepEqual(out,[]);assert.equal(c.count,0);
});
function rendererHarness(){const Renderer=require('../recorder/files/cluster/renderer').Renderer,c=clock(),clients=[],commits=[];class Client extends EventEmitter{constructor(){super();this.refs=new Map();this.n=0;this.frames=[];this.accept=true;clients.push(this);}image(o){this.refs.set(++this.n,Object.assign({},o));return this.n;}pixels(ref,rect,pixels){if(pixels.length>4){if(!this.accept)return false;this.frames.push({at:c.now(),ref,pixels:Buffer.from(pixels)});}return true;}set(ref,o){Object.assign(this.refs.get(ref),o);}drop(ref){this.refs.delete(ref);}connect(){}close(){this.refs.clear();}}const r=new Renderer(()=>new Client(),{},c);return {r,c,clients,commits};}
function atlas(id){const b=Buffer.alloc(31);b[4]=70;b.writeUInt32LE(id,9);Buffer.from([76,76,150,150,76,76,150,150,85,44,255,21]).copy(b,19);return b;}
test('renderer callback follows accepted cr.pixels and hidden/end generations cannot bleed into fades',()=>{
 const h=rendererHarness(),r=h.r,c=h.c;r.begin(1,()=>h.commits.push(c.now()));h.clients[0].emit('target','map','shown');r.paint(1,atlas(1),{vw:4,vh:2},'front');assert.equal(h.commits.length,0);c.advance(99);assert.equal(h.clients[0].frames.length,0);c.advance(1);assert.deepEqual(h.commits,[100]);
 r.paint(1,atlas(2),{vw:4,vh:2},'front');h.clients[0].emit('target','map','waiting');c.advance(200);assert.equal(h.commits.length,1);h.clients[0].emit('target','map','shown');r.paint(1,atlas(3),{vw:4,vh:2},'front');r.end(1);r.begin(2,()=>h.commits.push(c.now()));c.advance(200);assert.equal(h.commits.length,1);r.paint(2,atlas(4),{vw:4,vh:2},'right');h.clients[0].accept=false;c.advance(100);assert.equal(h.commits.length,1);h.clients[0].accept=true;r.paint(2,atlas(5),{vw:4,vh:2},'right');c.advance(100);assert.equal(h.commits.length,2);r.close();assert.equal(c.count,0);
});
test('older repeated IDs never count twice and callback failure clears all pending work',()=>{
 const c=clock(),out=[],errors=[],p=new Pacer(frame=>{out.push(frame.id);throw Error('commit failed');},c,e=>errors.push(e.message));p.begin(1);p.enqueue(1,{id:1});p.enqueue(1,{id:2});assert.equal(p.enqueue(1,{id:1}),false);c.advance(100);assert.deepEqual(out,[1]);assert.deepEqual(errors,['commit failed']);assert.equal(p.queue.length,0);assert.equal(c.count,0);p.close();
});
