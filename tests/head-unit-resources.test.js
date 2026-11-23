'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {memory,runningApps}=require('../recorder/files/head-unit-resources');

test('resources expose memory totals and only running deployed app IDs',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bv-resources-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const deploy=path.join(root,'state.json'),registry=path.join(root,'registry'),proc=path.join(root,'proc');
 fs.mkdirSync(registry);fs.mkdirSync(proc);
 fs.writeFileSync(deploy,JSON.stringify({apps:{example:{},inactive:{},bimmervision:{}}}));
 for(const [name,userId] of [['example',12228],['inactive',12229],['bimmervision',12230]])fs.writeFileSync(path.join(registry,name+'.json'),JSON.stringify({userId}));
 for(const [pid,uid,state] of [[11,12228,'S'],[12,12228,'R'],[13,12229,'Z'],[14,12230,'S'],[15,0,'S']]){
  fs.mkdirSync(path.join(proc,String(pid)));
  fs.writeFileSync(path.join(proc,String(pid),'status'),`Name: private-name\nState: ${state}\nUid: ${uid} ${uid}\nVmRSS: 50 kB\n`);
 }
 assert.deepEqual(runningApps({deploy,registry,proc}),{running:[{app:'example',processes:2,rssBytesSum:102400}],coverage:'mgu-deploy-apps'});
 assert.deepEqual(memory('MemTotal: 100 kB\nMemAvailable: 22 kB\nSwapFree: 14 kB'),{totalBytes:102400,availableBytes:22528,swapFreeBytes:14336});
});
