'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Recording}=require('../idrive/src/recording'),main=require('../recorder/files/main'),{UI}=require('../idrive/src/native-ui');
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-record-only-'))),ram=path.join(root,'ram'),prefs=path.join(root,'prefs');for(const dir of [ram,prefs])fs.mkdirSync(dir,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,ram,prefs,app:new Recording(ram,prefs)};}
test('old enabled preview preferences and controls cannot reappear in recorder or app intent',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.prefs,'cluster-preference.json'),'broken legacy preview setting',{mode:0o600});
 fs.writeFileSync(path.join(f.ram,'recorder-control.json'),JSON.stringify({continuous:false,cluster:{enabled:true,navigation:'always'}}),{mode:0o600});
 assert.equal(f.app.intent().continuous,false);assert.equal(f.app.intent().cluster,undefined);
 assert.equal((await new main.Controls(f.ram,process.getuid(),null,f.prefs).read()).cluster,undefined);
 f.app.update({continuous:true});assert.equal(f.app.intent().continuous,true);assert.equal(JSON.parse(fs.readFileSync(f.app.controlFile)).cluster,undefined);
});
test('home and settings offer recording storage and pairing without live-camera controls',async t=>{
 const f=fixture(t),labels={},visible={};f.app.read=()=>({state:'Stopped',drives:[],cluster:{state:'suspended',crashProtection:{tripped:true}}});
 const ui=new UI({recording:f.app,rhmi:{getByName:name=>({setValue:async(row,col,value)=>{labels[name]=value;},setVisible:async value=>{visible[name]=value;}})},display:{hide(){}}});ui.visible=true;
 await ui.render();assert.equal(visible.HOME_FRONT,false);assert.equal(labels.HOME_REAR,'USB storage');assert.equal(labels.HOME_LEFT,'Connect Phone');
 assert.doesNotMatch(Object.values(labels).join('\n'),/Cluster cameras|preview stopped|blinker cameras/i);
 await ui.press('HOME_RIGHT');assert.match(labels.HOME_STATUS,new RegExp(require('../idrive/package.json').version));
 for(const row of ['HOME_ALL','HOME_FRONT','HOME_REAR','HOME_LEFT'])assert.equal(visible[row],false,'settings only contains About and Back');
});
test('legacy camera settings do not start any camera capture when recording is paused',async t=>{
 const f=fixture(t),hardware=path.join(f.root,'hardware.json');fs.writeFileSync(hardware,JSON.stringify({uid:process.getuid(),hardwareTest:true,adapterVerified:true}));
 const prefsRoot=path.join(f.root,'saved');const saved=await main.preparePreferences(prefsRoot,process.getuid());fs.writeFileSync(path.join(saved,'cluster-preference.json'),JSON.stringify({enabled:true,navigation:'always'}),{mode:0o600});
 fs.writeFileSync(path.join(f.ram,'recorder-control.json'),JSON.stringify({continuous:false,cluster:{enabled:true}}),{mode:0o600});let captures=0,cameraStarts=0;
 const service=await main.start({root:path.resolve(__dirname,'../recorder/files'),configFile:hardware,ramRoot:f.ram,preferencesRoot:prefsRoot,controls:{read:()=>new main.Controls(f.ram,process.getuid(),null,saved).read(),write:async()=>{}},usbAdapters:{readMounts:()=>'',remount:false},spawnReceiver:()=>{captures++;throw Error('unexpected camera capture');},spawnCamera:()=>{cameraStarts++;throw Error('unexpected camera control');}});
 t.after(()=>service.stop());await new Promise(r=>setTimeout(r,700));assert.equal(captures,0);assert.equal(cameraStarts,0);assert.equal(service.status().cluster,undefined);assert.equal(service.status().recordingEnabled,false);
});
