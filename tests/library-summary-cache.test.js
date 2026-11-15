'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {Library}=require('../recorder/files/library'),io=require('../recorder/files/io');
const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-summary-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let checks=0,reads=0;const lib=new Library(root,{guard:{check:async()=>{checks++;}}}),manifest=lib.manifest;lib.manifest=function(id){reads++;return manifest.call(this,id);};return {root,lib,checks:()=>checks,reads:()=>reads,add(id,locked){const dir=path.join(root,id);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'capture.bvr'),'BVR1');fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({id,schemaVersion:1,format:'bvr1',complete:true,requiresPrevious:false,locked}));}};}
test('summary reuses validated unchanged entries while checking USB and discovering added recordings',async t=>{
 const f=fixture(t);f.add(first,false);assert.deepEqual(await f.lib.summary(),{recordingCount:1,lockedRecordingCount:0});assert.deepEqual(await f.lib.summary(),{recordingCount:1,lockedRecordingCount:0});
 assert.equal(f.checks(),2);assert.equal(f.reads(),1,'unchanged entries must avoid repeated full manifest traversal and reads');
 f.add(second,true);assert.deepEqual(await f.lib.summary(),{recordingCount:2,lockedRecordingCount:1});assert.equal(f.reads(),2);
 await f.lib.setLocked(first,true);assert.deepEqual(await f.lib.summary(),{recordingCount:2,lockedRecordingCount:2});
});
test('external manifest replacements and unsafe paths cannot reuse a cached lock count',async t=>{
 const f=fixture(t);f.add(first,false);await f.lib.summary();const file=path.join(f.root,first,'manifest.json');
 const m=JSON.parse(fs.readFileSync(file));m.locked=true;await io.atomicJSON(file,m);assert.equal((await f.lib.summary()).lockedRecordingCount,1);
 fs.unlinkSync(file);fs.symlinkSync(path.join(f.root,'outside.json'),file);fs.writeFileSync(path.join(f.root,'outside.json'),JSON.stringify(m));assert.equal((await f.lib.summary()).lockedRecordingCount,null);
 fs.unlinkSync(file);fs.writeFileSync(file,JSON.stringify(m));await f.lib.summary();const dir=path.join(f.root,first),moved=path.join(f.root,'moved');fs.renameSync(dir,moved);fs.symlinkSync(moved,dir);assert.equal((await f.lib.summary()).lockedRecordingCount,null);
});
