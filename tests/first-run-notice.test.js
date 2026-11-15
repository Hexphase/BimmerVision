'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
let Notice;try{Notice=require('../idrive/src/first-run-notice').Notice;}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
function dir(t){const d=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bv-first-run-'));fs.chmodSync(d,0o700);t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
test('camera conflict notice stays pending until acknowledged, then survives an app restart',t=>{
 assert.ok(Notice);const d=dir(t),n=new Notice(d,process.getuid());assert.equal(n.pending(),true);assert.deepEqual(fs.readdirSync(d),[]);n.acknowledge();assert.equal(new Notice(d,process.getuid()).pending(),false);assert.equal(fs.statSync(path.join(d,'camera-conflict-notice.json')).mode&511,0o600);
});
test('notice acknowledgement refuses symlinks instead of overwriting another file',t=>{
 assert.ok(Notice);const d=dir(t),target=path.join(d,'keep');fs.writeFileSync(target,'keep',{mode:0o600});fs.symlinkSync(target,path.join(d,'camera-conflict-notice.json'));const n=new Notice(d,process.getuid());assert.throws(()=>n.acknowledge(),/Unsafe/);assert.equal(fs.readFileSync(target,'utf8'),'keep');
});
test('first-run warning requires Understood and does not enable or pause recording',async t=>{
 const {UI}=require('../idrive/src/native-ui'),labels=[],changes=[],state={continuous:false};let pending=true;
 const ui=new UI({onboarding:{pending:()=>pending,acknowledge:()=>{pending=false;}},recording:{read:()=>({state:'Stopped',drives:[]}),intent:()=>state,update:p=>changes.push(p)},rhmi:{getByName:()=>({setValue:async(r,c,v)=>{labels.push(v);}}),mapEntryState:async()=>{},openEntryState:async()=>{},openState:async()=>{}},display:{hide(){}}});
 await ui.openMenu();assert.equal(ui.page,'welcome');assert.match(labels.join('\n'),/third-party apps/);assert.match(labels.join('\n'),/all camera views/);assert.equal(pending,true);await ui.press('HOME_ALL');assert.equal(ui.page,'home');assert.equal(pending,false);assert.deepEqual(changes,[]);await ui.openMenu();assert.equal(ui.page,'home');
});
