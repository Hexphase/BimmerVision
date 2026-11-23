'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {measure}=require('../recorder/files/usb-speed-test');

test('speed test writes, flushes and removes only its own temporary file',async t=>{
 const mount=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-speed-')));
 t.after(()=>fs.rmSync(mount,{recursive:true,force:true}));
 fs.writeFileSync(path.join(mount,'keep'),'original');
 const guard={mount,check(){}};
 let elapsed=0;
 const result=await measure(guard,()=>({free:120*1024*1024}),()=>elapsed+=100000,()=>{});
 assert.equal(result.bytes,16*1024*1024);
 assert.equal(result.result,'headroom');
 assert.equal(result.worstFlushMs,100);
 assert.deepEqual(fs.readdirSync(mount),['keep']);
 await assert.rejects(measure(guard,()=>({free:1}),()=>0,()=>{}),/80 MiB/);
 assert.deepEqual(fs.readdirSync(mount),['keep']);
});
