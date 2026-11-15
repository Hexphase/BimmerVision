'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function monitor(){const {RecordingHealth}=require('../idrive/src/recording-health');return new RecordingHealth();}
function good(ms){return {state:'Recording',activeId:'clip',heartbeatMonotonicUs:ms*1000,metrics:{lastVideoWriteMonotonicUs:ms*1000,writtenVideoPackets:ms}};}
test('sustained interruption warns once, then restored requires stable fresh write progress',()=>{const h=monitor(),on={continuous:true};assert.equal(h.update(good(1000),on,1000),null);let bad={state:'Waiting for stream',heartbeatMonotonicUs:2000000,metrics:{}};assert.equal(h.update(bad,on,2000),null);bad.heartbeatMonotonicUs=7000000;assert.equal(h.update(bad,on,7000).kind,'interrupted');assert.equal(h.update(bad,on,8000),null);assert.equal(h.update(good(9000),on,9000),null);assert.equal(h.update(good(12000),on,12000).kind,'restored');assert.equal(h.update(good(13000),on,13000),null);});
test('Pause and short camera/rotation gaps never warn; optional telemetry errors do not hide healthy video',()=>{const h=monitor(),on={continuous:true};h.update(good(1000),on,1000);assert.equal(h.update({state:'Camera unavailable'},on,2000),null);assert.equal(h.update(good(6000),on,6000),null);assert.equal(h.update({...good(7000),error:'Optional telemetry source unavailable'},on,7000),null);assert.equal(h.update({state:'Drive unavailable'},{continuous:false},8000),null);assert.equal(h.update({state:'Drive unavailable'},{continuous:false},999999),null);});
test('stale service status and accepted packets without successful writes are unhealthy',()=>{for(const stale of [true,false]){const h=monitor(),on={continuous:true};h.update(good(1000),on,1000);const stuck=good(1000);stuck.metrics.packets=999999;if(!stale)stuck.heartbeatMonotonicUs=10000000;assert.equal(h.update(stuck,on,10000),null);if(!stale)stuck.heartbeatMonotonicUs=15000000;assert.equal(h.update(stuck,on,15000).kind,'interrupted');}});
test('startup has a grace period, no stale-recovery claim, and repeated failures have a cooldown',()=>{const h=monitor(),on={continuous:true};assert.equal(h.update({state:'Waiting for stream'},on,1000),null);assert.equal(h.update({state:'Waiting for stream'},on,20999),null);assert.equal(h.update({state:'Waiting for stream'},on,21000).kind,'interrupted');h.update(good(22000),on,22000);assert.equal(h.update(good(22000),on,25000),null,'one old write cannot establish recovery');h.update(good(26000),on,26000);assert.equal(h.update(good(29000),on,29000).kind,'restored');assert.equal(h.update({state:'Storage full'},on,30000),null);assert.equal(h.update({state:'Storage full'},on,40000),null);assert.match(h.update({state:'Storage full',heartbeatMonotonicUs:142000000},on,142000).message,/USB full/);});
test('initial setup does not warn but setup after a recording failure cannot silence an outage',()=>{const h=monitor(),on={continuous:true};h.update({setupPending:true},on,1000);assert.equal(h.update({setupPending:true},on,999999),null);h.update(good(1000000),on,1000000);h.update({setupPending:true},on,1001000);assert.equal(h.update({setupPending:true},on,1006000).kind,'interrupted');});
test('failed notification delivery retries after a bounded delay and Pause cancels that retry',()=>{const h=monitor(),on={continuous:true};h.update(good(1000),on,1000);h.update({},on,2000);assert.equal(h.update({},on,7000).kind,'interrupted');h.deliveryFailed('interrupted',7000);assert.equal(h.update({},on,16000),null);assert.equal(h.update({},on,17000).kind,'interrupted');h.deliveryFailed('interrupted',17000);assert.equal(h.update({},{continuous:false},18000),null);assert.equal(h.update({},{continuous:false},999999),null);});
test('confirmed USB failure warns promptly even before the first recording',()=>{
 const h=monitor(),on={continuous:true};
 const bad={state:'Drive unavailable',heartbeatMonotonicUs:1000000};
 assert.equal(h.update(bad,on,1000),null);
 assert.equal(h.update({...bad,heartbeatMonotonicUs:2500000},on,2500),null);
 const notice=h.update({...bad,heartbeatMonotonicUs:3000000},on,3000);
 assert.equal(notice.kind,'interrupted');assert.match(notice.message,/USB/);
 assert.equal(h.update({...bad,heartbeatMonotonicUs:4000000},on,4000),null);
});
test('fresh video does not hide actual packet loss and a degraded warning never suppresses an outage',()=>{
 const h=monitor(),on={continuous:true};h.update({...good(1000),metrics:{...good(1000).metrics,applicationDroppedPackets:0}},on,1000);
 const degraded={...good(2000),metrics:{...good(2000).metrics,applicationDroppedPackets:5}};
 const notice=h.update(degraded,on,2000);assert.equal(notice.kind,'degraded');assert.match(notice.message,/dropped/i);
 assert.equal(h.update({...good(3000),metrics:{...good(3000).metrics,applicationDroppedPackets:5}},on,3000),null,'cumulative drops must not repeat warnings');
 h.update({state:'Storage full',heartbeatMonotonicUs:4000000},on,4000);
 const stopped=h.update({state:'Storage full',heartbeatMonotonicUs:6000000},on,6000);
 assert.equal(stopped.kind,'interrupted');assert.match(stopped.message,/USB full/);
});
test('sustained USB backlog warns while transient backlog and intentional Pause stay quiet',()=>{
 const h=monitor(),on={continuous:true};const slow=ms=>({...good(ms),metrics:{...good(ms).metrics,queuedBytes:60,queueLimit:100}});
 assert.equal(h.update(slow(1000),on,1000),null);assert.equal(h.update(good(2000),on,2000),null);
 assert.equal(h.update(slow(3000),on,3000),null);assert.equal(h.update(slow(4999),on,4999),null);
 const n=h.update(slow(5000),on,5000);assert.equal(n.kind,'degraded');assert.match(n.message,/USB/);
 assert.equal(h.update(slow(6000),{continuous:false},6000),null);
 assert.equal(h.update(good(7000),on,7000),null);
});
test('failed quality alert retries without blocking a more important recording failure',()=>{
 const h=monitor(),on={continuous:true};h.update(good(1000),on,1000);
 const dropped=ms=>({...good(ms),metrics:{...good(ms).metrics,applicationDroppedPackets:1}});
 assert.equal(h.update(dropped(2000),on,2000).kind,'degraded');h.deliveryFailed('degraded',2000);
 assert.equal(h.update(dropped(11000),on,11000),null);
 assert.equal(h.update(dropped(12000),on,12000).kind,'degraded');h.deliveryFailed('degraded',12000);
 h.update({state:'Drive unavailable',heartbeatMonotonicUs:13000000},on,13000);
 assert.equal(h.update({state:'Drive unavailable',heartbeatMonotonicUs:15000000},on,15000).kind,'interrupted');
});
test('a USB backlog that clears during the cooldown cannot produce a stale warning later',()=>{
 const h=monitor(),on={continuous:true},slow=ms=>({...good(ms),metrics:{...good(ms).metrics,queuedBytes:60,queueLimit:100}});
 h.update(slow(1000),on,1000);assert.equal(h.update(slow(3000),on,3000).kind,'degraded');
 h.update(slow(4000),on,4000);assert.equal(h.update(good(5000),on,5000),null);
 assert.equal(h.update(good(125000),on,125000),null);
});
