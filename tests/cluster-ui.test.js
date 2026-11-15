'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {Recording}=require('../idrive/src/recording'),{UI}=require('../idrive/src/native-ui');
function fixture(t){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bv-cluster-ui-')),ram=path.join(root,'ram'),saved=path.join(root,'saved');for(const dir of [ram,saved])fs.mkdirSync(dir,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,ram,saved,app:new Recording(ram,saved)};}
function screen(recording,delay){const labels={},visible={},enabled={};const ui=new UI({recording,rhmi:{getByName:name=>({setValue:async (row,column,value)=>{if(delay)await delay(name,value);labels[name]=value;},setVisible:async value=>{visible[name]=value;},setEnabled:async value=>{enabled[name]=value;}})},display:{hide(){}}});ui.visible=true;return {ui,labels,visible,enabled};}
test('cluster defaults stay off and durable changes survive RAM loss without changing recording preference',t=>{
 const f=fixture(t);assert.deepEqual(f.app.intent().cluster,{enabled:false,navigation:'blinkers',blinkersOnly:false});
 f.app.update({continuous:true});const file=path.join(f.saved,'recording-preference.json'),before=fs.readFileSync(file);
 f.app.update({cluster:{enabled:true}});f.app.update({cluster:{navigation:'always'}});
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.saved,'cluster-preference.json'))),{enabled:true,navigation:'always',blinkersOnly:false});assert.deepEqual(fs.readFileSync(file),before);
 fs.rmSync(f.ram,{recursive:true});fs.mkdirSync(f.ram,0o700);assert.equal(f.app.intent().continuous,true);assert.deepEqual(f.app.intent().cluster,{enabled:true,navigation:'always',blinkersOnly:false});
 f.app.update({cluster:{enabled:false}});assert.equal(f.app.intent().continuous,true);assert.deepEqual(f.app.intent().cluster,{enabled:false,navigation:'always',blinkersOnly:false});
});
test('cluster preferences merge validated fields and reject unsafe files without replacing them',t=>{
 const f=fixture(t),p=require('../idrive/src/cluster-preference'),owner=process.getuid();
 assert.equal(p.location(owner),'/var/opt/bimmervision-recorder/preferences/'+owner);assert.deepEqual(p.read(f.saved,owner),{enabled:false,navigation:'blinkers',blinkersOnly:false});
 assert.deepEqual(p.write(f.saved,owner,{navigation:'off'}),{enabled:false,navigation:'off',blinkersOnly:false});assert.deepEqual(p.write(f.saved,owner,{enabled:true}),{enabled:true,navigation:'off',blinkersOnly:false});
 const file=path.join(f.saved,'cluster-preference.json');assert.equal(fs.statSync(file).mode&511,0o600);
 for(const patch of [{enabled:1},{navigation:'sometimes'},{continuous:false},null,[],JSON.parse('{"__proto__":{}}')])assert.throws(()=>p.write(f.saved,owner,patch),/Invalid cluster preference/);
 fs.chmodSync(file,0o644);assert.throws(()=>p.read(f.saved,owner),/Unsafe cluster preference/);fs.chmodSync(file,0o600);
 fs.unlinkSync(file);const target=path.join(f.root,'target');fs.writeFileSync(target,'{"enabled":true,"navigation":"always"}',{mode:0o600});fs.symlinkSync(target,file);
 assert.throws(()=>p.write(f.saved,owner,{enabled:false}),/Cluster preference|cluster preference/);assert.equal(JSON.parse(fs.readFileSync(target)).enabled,true);
 fs.unlinkSync(file);fs.chmodSync(f.saved,0o755);assert.throws(()=>p.read(f.saved,owner),/Unsafe cluster preference directory/);
});
test('cluster preference read failure disables preview while preserving actual recording intent',t=>{
 const f=fixture(t);f.app.update({continuous:true});fs.writeFileSync(path.join(f.saved,'cluster-preference.json'),'broken',{mode:0o600});
 assert.equal(f.app.intent().continuous,true);assert.deepEqual(f.app.intent().cluster,{enabled:false,navigation:'blinkers',blinkersOnly:false});
 const before=fs.readFileSync(f.app.controlFile);assert.throws(()=>f.app.update({cluster:{enabled:true}}),/preference/i);assert.deepEqual(fs.readFileSync(f.app.controlFile),before);assert.equal(f.app.intent().continuous,true);
});
test('home cluster action works without USB or setup and leaves recording enabled',async t=>{
 const f=fixture(t);f.app.update({continuous:true});f.app.read=()=>({state:'Setup pending',setupPending:true,drives:[]});const s=screen(f.app);
 await s.ui.render();assert.equal(s.labels.HOME_FRONT,'Cluster cameras: Off');assert.equal(s.enabled.HOME_FRONT,true);assert.equal(s.enabled.HOME_ALL,false);assert.equal(s.enabled.HOME_LEFT,false);
 assert.equal(s.labels.HOME_REAR,'USB storage');assert.equal(s.labels.HOME_LEFT,'Connect Phone');assert.equal(s.labels.HOME_RIGHT,'Settings / About');
 await s.ui.press('HOME_FRONT');assert.equal(f.app.intent().cluster.enabled,true);assert.equal(f.app.intent().continuous,true);assert.equal(s.labels.HOME_FRONT,'Cluster cameras: On');
 await s.ui.press('HOME_REAR');assert.equal(s.ui.page,'usb');await s.ui.back();f.app.read=()=>({state:'Stopped',drives:[]});await s.ui.press('HOME_LEFT');assert.equal(s.ui.page,'home');assert.match(s.ui.message,/USB/);
});
test('settings navigation rows select exactly one durable policy and retain dynamic About version',async t=>{
 const f=fixture(t);f.app.read=()=>({state:'Starting',setupPending:true,drives:[]});const s=screen(f.app);await s.ui.press('HOME_RIGHT');assert.equal(s.ui.page,'settings');
 assert.match(s.labels.HOME_STATUS,new RegExp('BimmerVision '+require('../idrive/package.json').version));assert.match(s.labels.HOME_FRONT,/^✓ Navigation: Blinkers only$/);
 for(const [row,mode] of [['HOME_ALL','always'],['HOME_REAR','off'],['HOME_FRONT','blinkers']]){
  await s.ui.press(row);assert.equal(f.app.intent().cluster.navigation,mode);assert.equal(['HOME_ALL','HOME_FRONT','HOME_REAR'].filter(n=>s.labels[n].indexOf('✓ ')===0).length,1);assert.match(s.labels[row],/^✓ /);
 }
});
test('rapid cluster toggles persist synchronously and overlapping paints end on the latest label',async t=>{
 const f=fixture(t);f.app.update({continuous:true});f.app.read=()=>({state:'Stopped',drives:[]});let release,started;const blocked=new Promise(resolve=>{started=resolve;}),s=screen(f.app,async (name,value)=>{if(name==='HOME_FRONT'&&!release){started();await new Promise(resolve=>{release=resolve;});}});
 const old=s.ui.render();await blocked;const pending=[];for(let n=0;n<31;n++)pending.push(s.ui.press('HOME_FRONT'));
 const latest=f.app.intent();await new Promise(resolve=>setImmediate(resolve));release();await Promise.all([old].concat(pending));assert.deepEqual(latest.cluster,{enabled:true,navigation:'blinkers',blinkersOnly:false});assert.equal(latest.continuous,true);assert.equal(s.labels.HOME_FRONT,'Cluster cameras: On');
});
test('preview status stays in its action while recording state and errors remain visible',async t=>{
 const f=fixture(t);f.app.update({continuous:true,cluster:{enabled:true}});let desk={state:'Recording',activeId:'active',drive:{name:'USB'},drives:[],cluster:{enabled:true,state:'starting'}};f.app.read=()=>desk;const s=screen(f.app);
 await s.ui.render();assert.equal(s.labels.HOME_FRONT,'Cluster cameras: On · Starting');assert.match(s.labels.HOME_STATUS,/^Recording\n/);
 desk.cluster={enabled:true,state:'waiting',reason:'Waiting for camera'};await s.ui.render();assert.equal(s.labels.HOME_FRONT,'Cluster cameras: On · Waiting');
 desk.error='USB write failed';desk.cluster={enabled:true,state:'error',error:'Decoder unavailable'};await s.ui.render();assert.equal(s.labels.HOME_FRONT,'Cluster cameras: On · Preview unavailable');assert.match(s.labels.HOME_STATUS,/^USB write failed\n/);assert.doesNotMatch(s.labels.HOME_STATUS,/Decoder|Preview unavailable/);
 await s.ui.press('HOME_FRONT');assert.equal(s.labels.HOME_FRONT,'Cluster cameras: Off');assert.match(s.labels.HOME_STATUS,/^USB write failed\n/);assert.equal(f.app.intent().continuous,true);
});
test('Only blinker cameras is durable, defaults off for existing settings and does not change recording',async t=>{const f=fixture(t);fs.writeFileSync(path.join(f.saved,'cluster-preference.json'),'\{"enabled":true,"navigation":"always"\}',{mode:0o600});assert.equal(f.app.intent().cluster.blinkersOnly,false);f.app.update({continuous:true});const before=fs.readFileSync(path.join(f.saved,'recording-preference.json'));f.app.read=()=>({state:'Recording',drives:[]});const s=screen(f.app);await s.ui.press('HOME_RIGHT');assert.equal(s.labels.HOME_LEFT,'Only blinker cameras: Off');await s.ui.press('HOME_LEFT');assert.equal(s.labels.HOME_LEFT,'Only blinker cameras: On');assert.equal(f.app.intent().cluster.blinkersOnly,true);assert.equal(f.app.intent().cluster.navigation,'always');assert.equal(f.app.intent().cluster.enabled,true);fs.rmSync(f.ram,{recursive:true});fs.mkdirSync(f.ram,0o700);assert.equal(f.app.intent().cluster.blinkersOnly,true);assert.deepEqual(fs.readFileSync(path.join(f.saved,'recording-preference.json')),before);await s.ui.press('HOME_LEFT');assert.equal(f.app.intent().cluster.blinkersOnly,false);assert.throws(()=>f.app.update({cluster:{blinkersOnly:'yes'}}),/Invalid cluster preference/);});
