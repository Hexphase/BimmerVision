'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {Recording}=require('../idrive/src/recording'),{Controls}=require('../recorder/files/main'),{UI}=require('../idrive/src/native-ui');
function fixture(t){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bv-preference-')),ram=path.join(root,'ram'),saved=path.join(root,'saved');for(const dir of [ram,saved])fs.mkdirSync(dir,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,ram,saved,app:()=>new Recording(ram,saved),backend:()=>new Controls(ram,process.getuid(),null,saved)};}
test('Enable and Pause survive loss of all RAM controls without replaying phone or erase commands',async t=>{
 const f=fixture(t);
 for(const continuous of [true,false]){
  f.app().update({continuous,transfer:{visible:true,visit:'old'},deleteAll:{confirmed:true,id:'old'}});
  fs.rmSync(f.ram,{recursive:true});fs.mkdirSync(f.ram,0o700);
  assert.equal(f.app().intent().continuous,continuous);
  const control=await f.backend().read();assert.equal(control.continuous,continuous);assert.equal(control.transfer.visible,false);assert.equal(control.deleteAll,undefined);
 }
});
test('missing setting shows Enable and the first press enables recording',async t=>{
 const f=fixture(t),labels={},recording=f.app();recording.read=()=>({state:'Stopped',drive:{name:'USB'},drives:[]});
 const ui=new UI({recording,rhmi:{getByName:name=>({setValue:async (row,column,value)=>{labels[name]=value;}})},display:{hide(){}}});ui.visible=true;
 await ui.render();assert.equal(labels.HOME_ALL,'Enable recording');await ui.press('HOME_ALL');assert.equal((await f.backend().read()).continuous,true);assert.equal(labels.HOME_ALL,'Pause recording');
});
test('existing explicit RAM preference migrates once and durable preference wins over stale RAM',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.ram,'recorder-control.json'),JSON.stringify({continuous:true}),{mode:0o600});
 assert.equal((await f.backend().read()).continuous,true);fs.rmSync(f.ram,{recursive:true});fs.mkdirSync(f.ram,0o700);
 assert.equal((await f.backend().read()).continuous,true);
 f.app().update({continuous:false});fs.writeFileSync(path.join(f.ram,'recorder-control.json'),JSON.stringify({continuous:true}),{mode:0o600});
 assert.equal(f.app().intent().continuous,false);assert.equal((await f.backend().read()).continuous,false);
});
test('unsafe or malformed saved settings cannot silently enable capture',async t=>{
 const f=fixture(t);f.app().update({continuous:true});const file=path.join(f.saved,'recording-preference.json');
 fs.writeFileSync(file,'{"continuous":"true"}');assert.throws(()=>f.app().update({continuous:true}),/preference/i);await assert.rejects(f.backend().read(),/preference/i);
 fs.unlinkSync(file);const target=path.join(f.root,'target');fs.writeFileSync(target,'{"continuous":true}',{mode:0o600});fs.symlinkSync(target,file);
 assert.throws(()=>f.app().update({continuous:false}),/preference|Unsafe/i);await assert.rejects(f.backend().read(),/preference|Unsafe/i);assert.equal(JSON.parse(fs.readFileSync(target)).continuous,true);
});
test('migration cannot overwrite a newer persisted Pause and preference directories are private',async t=>{
 const f=fixture(t),main=require('../recorder/files/main'),preference=require('../recorder/files/recording-preference');
 const dir=await main.preparePreferences(path.join(f.root,'preferences'),process.getuid());assert.equal(fs.statSync(dir).mode&511,448);
 preference.write(dir,process.getuid(),false);preference.write(dir,process.getuid(),true,true);assert.equal(preference.read(dir,process.getuid()),false);
 const parent=path.join(f.root,'bad-parent');fs.symlinkSync(path.join(f.root,'preferences'),parent);await assert.rejects(main.preparePreferences(parent,process.getuid()),/Symlink/i);
});
