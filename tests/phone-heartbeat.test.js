'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {Recording}=require('../idrive/src/recording');
async function settle(){for(let n=0;n<100;n++)await Promise.resolve();}
async function fixture(t){
 t.mock.timers.enable({apis:['setInterval','Date'],now:10000});
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bv-phone-beat-')),ram=path.join(root,'ram'),prefs=path.join(root,'prefs');for(const p of [ram,prefs])fs.mkdirSync(p,0o700);
 const recording=new Recording(ram,prefs);fs.writeFileSync(recording.statusFile,JSON.stringify({state:'Stopped',drive:{mount:'/test-usb'},drives:[]}),{mode:0o600});recording.update({continuous:false});
 const app=new EventEmitter(),rhmi=new EventEmitter(),components=new Map(),errors=[];let hold=null;
 app.start=async()=>{};app.registerActive=async()=>{};app.rhmiApplication=rhmi;
 rhmi.getByName=name=>{if(!components.has(name)){const c=new EventEmitter();c.getId=()=>1;c.updateResources=async()=>{};c.setVisible=async()=>{};c.setEnabled=async()=>{};c.setValue=async()=>{if(hold&&name==='HOME_TITLE')await hold;};components.set(name,c);}return components.get(name);};rhmi.mapEntryState=async()=>{};rhmi.openState=async()=>{};rhmi.openEntryState=async()=>{};
 const runtime=await require('../idrive/src/app').start({app,recording,onboarding:{pending:()=>false},health:{update:()=>null},display:{hide(){}},nowMs:()=>Date.now(),log:e=>errors.push(e)});
 t.after(()=>{runtime.close();fs.rmSync(root,{recursive:true,force:true});});
 t.mock.timers.tick(500);await settle();assert.equal(recording.intent().transfer,undefined,'hidden startup must not create a transfer lease');
 await runtime.ui.openMenu();await runtime.ui.press('HOME_LEFT');
 return {runtime,recording,errors,tick:async()=>{t.mock.timers.tick(500);await settle();},blockPaint(){hold=new Promise(r=>{this.release=r;});runtime.ui.cache.HOME_TITLE='old';},hide(){components.get('HOME').emit('visible',{visible:false});},components};
}
test('Connect Phone lease stays fresh through a paint held longer than three seconds and Back revokes immediately',async t=>{
 const h=await fixture(t);h.blockPaint();await h.tick();
 for(let n=0;n<8;n++){await h.tick();assert.equal(h.recording.intent().transfer.heartbeat,Date.now(),'pending RHMI paint must not starve the phone lease');}
 const backing=h.runtime.ui.back();assert.equal(h.recording.intent().transfer.visible,false);const revoked=h.recording.intent().transfer.heartbeat;await h.tick();assert.equal(h.recording.intent().transfer.heartbeat,revoked);h.release();await backing;assert.equal(h.recording.intent().continuous,false);
});
test('Connect Phone heartbeat runs before a pending health alert and hide or close ceases renewal',async t=>{
 const h=await fixture(t);let release;h.runtime.ui.component('RECORDING_ALERT').updateResources=()=>new Promise(r=>{release=r;});h.recording.update({notificationTest:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',requestedAtMonotonicMs:Date.now()}});
 await h.tick();assert.equal(typeof release,'function');for(let n=0;n<8;n++){await h.tick();assert.equal(h.recording.intent().transfer.heartbeat,Date.now(),'pending health delivery must not starve the phone lease');}
 h.hide();assert.equal(h.recording.intent().transfer.visible,false);const revoked=h.recording.intent().transfer.heartbeat;await h.tick();assert.equal(h.recording.intent().transfer.heartbeat,revoked);release();await settle();await h.runtime.ui.openMenu();await h.runtime.ui.press('HOME_LEFT');await h.tick();h.runtime.close();assert.equal(h.recording.intent().transfer.visible,false);const closedBeat=h.recording.intent().transfer.heartbeat;await h.tick();assert.equal(h.recording.intent().transfer.heartbeat,closedBeat);
});
test('a heartbeat write failure is handled and later timer ticks can renew the visit',async t=>{
 const h=await fixture(t);h.blockPaint();await h.tick();fs.chmodSync(h.recording.directory,0o755);try{await h.tick();assert.ok(h.errors.some(e=>/Unsafe recorder RAM directory/.test(e.message)));}finally{fs.chmodSync(h.recording.directory,0o700);}
 await h.tick();assert.equal(h.recording.intent().transfer.heartbeat,Date.now());h.release();await settle();
});
