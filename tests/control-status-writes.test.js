'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Controls}=require('../recorder/files/main');
test('concurrent status publishers serialize atomic JSON writes and recover after a failure',async()=>{
 const c=new Controls('/unused',1);let active=0,peak=0,release;const entered=[],gate=new Promise(r=>release=r);
 c.writeNow=async s=>{active++;peak=Math.max(peak,active);entered.push(s.n);try{if(s.n===1){await gate;throw Error('USB independent RAM failure');}}finally{active--;}};
 const a=c.write({n:1}),b=c.write({n:2}),d=c.write({n:3});await new Promise(r=>setImmediate(r));assert.deepEqual(entered,[1]);release();await assert.rejects(a,/RAM failure/);await Promise.all([b,d]);assert.deepEqual(entered,[1,2,3]);assert.equal(peak,1);
});
