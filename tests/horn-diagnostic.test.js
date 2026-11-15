'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Horn}=require('../recorder/files/horn'),{Perception,schemaEvent}=require('../recorder/files/perception');
function response(hex){const u=Buffer.from(hex,'hex'),b=Buffer.alloc(9+u.length);Buffer.from('f0f271010f0b40','hex').copy(b);b.writeUInt16BE(u.length,7);u.copy(b,9);const p=Buffer.alloc(4+b.length+6);p.writeUInt32BE(b.length);b.copy(p,4);p.writeUInt16BE(b.length,4+b.length);return p;}
test('BDC horn read preserves pressed/released state and rejects wrong replies',()=>{
 let now=1000;const events=[],writes=[],h=new Horn({nowMs:()=>now,nowUs:()=>now*1000,onEvent:e=>events.push(e)});h.start(s=>writes.push(s));h.tick();assert.equal(writes[0],'call 0xf8a6 128 1 1 f2402200000200000002d29700');
 assert.equal(h.receiveProxy(response('62d29801')),false);assert.equal(h.pending,1000);
 now=1007;assert.equal(h.receiveProxy(response('62d29701')),true);assert.equal(events.at(-1).pressed,true);assert.equal(events.at(-1).roundTripMs,7);assert.equal(events.at(-1).requestHex,'22d297');
 now=1100;h.tick();now=1105;h.receiveProxy(response('62d29700'));assert.equal(events.at(-1).pressed,false);
 now=1200;h.tick();h.receiveProxy(response('62d29703'));assert.equal(events.at(-1).type,'horn-status');assert.equal(events.at(-1).state,'unavailable');assert.equal(events.at(-1).pressed,undefined);
});
test('horn read stays bounded on delayed, denied and malformed replies',()=>{
 let now=0;const events=[],writes=[],h=new Horn({nowMs:()=>now,nowUs:()=>now*1000,onEvent:e=>events.push(e)});h.start(s=>writes.push(s));h.tick();for(now=100;now<2000;now+=100)h.tick();assert.equal(writes.length,1);
 h.tick();assert.equal(events.at(-1).requiresTransportRestart,true);assert.equal(h.send,null);
 assert.equal(h.receiveProxy(response('62d29701')),false);
 h.start(s=>writes.push(s));h.tick();h.receiveProxy(response('7f2231'));const n=writes.length;now+=1000;h.tick();assert.equal(writes.length,n);now+=30000;h.tick();assert.equal(writes.length,n+1);
 const malformed=response('62d29701');malformed[0]=1;assert.equal(h.receiveProxy(malformed),false);h.stop();assert.equal(h.send,null);
});
test('mirror and horn diagnostics never issue overlapping requests',()=>{
 let now=0;const writes=[],p=new Perception({mirrorOnly:true,nowMs:()=>now,nowUs:()=>now*1000});p.blindSpot.start(s=>writes.push(s));p.horn.start(s=>writes.push(s));
 p.tickDiagnostics();assert.match(writes[0],/d34700$/);now=100;p.tickDiagnostics();assert.equal(writes.length,1);
 p.line('ev 0xf8a6 0x8001 '+response('62d3470000').toString('hex'));now=200;p.tickDiagnostics();assert.match(writes[1],/d29700$/);
 now=300;p.tickDiagnostics();assert.equal(writes.length,2);p.line('ev 0xf8a6 0x8001 '+response('62d29701').toString('hex'));
 now=500;p.tickDiagnostics();assert.match(writes[2],/d34700$/);p.blindSpot.stop();p.horn.stop();
 assert.ok(schemaEvent().diagnosticSources.some(s=>s.requestHex==='22d297'));
});
