'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Recorder}=require('../recorder/files/recorder'),archive=require('../recorder/files/archive');
test('recovery scans across chunk boundaries and keeps a valid prefix with bounded guard checks',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-recovery-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',dir=path.join(root,id+'.partial');
 fs.mkdirSync(dir);
 const valid=Buffer.concat([archive.header(),...Array.from({length:2300},(_,i)=>archive.record(1,i+1,Buffer.alloc(1024,19)))]);
 fs.writeFileSync(path.join(dir,'capture.bvr'),Buffer.concat([valid,archive.record(1,2301,Buffer.alloc(30)).slice(0,42)]));
 let guards=0;
 const [m]=await Recorder.recover(root,{check(){guards++;}});
 assert.equal(m.packets,2300);
 assert.equal(m.bytes,valid.length);
 assert.deepEqual(fs.readFileSync(path.join(root,id,'capture.bvr')),valid);
 assert.ok(guards<32,`recovery performed ${guards} guard checks`);
});
