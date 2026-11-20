'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {buildLink}=require('../recorder/files/mobile-web/phone-backup-launch');
test('phone backup launch sends car pairing only in the hosted URL fragment',()=>{
 const link=new URL(buildLink('http://192.168.100.1:8765','12345678'));
 assert.equal(link.origin,'https://bimmervision.app');assert.equal(link.search,'');const hash=new URLSearchParams(link.hash.slice(1));assert.equal(hash.get('car'),'http://192.168.100.1:8765');assert.equal(hash.get('code'),'12345678');assert.equal(hash.get('backup'),'1');
 for(const origin of ['https://evil.example','http://user:pass@192.168.1.1','http://192.168.1.1/path','file:///tmp','http://8.8.8.8','http://192.168.1.1/?token=secret'])assert.throws(()=>buildLink(origin,'12345678'));
 assert.throws(()=>buildLink('http://192.168.1.1:8765','bad'));
});
test('car web server exposes an explicit phone cloud backup action and network disclosure',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../recorder/files/mobile-web/index.html'),'utf8');assert.match(html,/id="phoneBackupOpen"/);assert.match(html,/phone-backup-launch.js/);assert.match(html,/cellular/);
});

test('selected clip is a strict UUID carried only in the hosted fragment',()=>{
 const clip='8136e19b-d2fb-4c10-9f55-634ea298980e';
 const link=new URL(buildLink('http://192.168.100.1:8765','12345678',clip));
 assert.equal(link.pathname,'/');assert.equal(link.search,'');
 assert.equal(new URLSearchParams(link.hash.slice(1)).get('clip'),clip);
 assert.equal(new URLSearchParams(new URL(buildLink('http://192.168.100.1:8765','12345678')).hash.slice(1)).has('clip'),false);
 for(const invalid of ['',null,'../recording','8136e19b-d2fb-4c10-9f55-634ea298980e&consent=1','8136e19bd2fb4c109f55634ea298980e'])assert.throws(()=>buildLink('http://192.168.100.1:8765','12345678',invalid));
});

function launchHarness({blocked=false,bridgeFailure=false,hasSettings=true}={}){
 const vm=require('node:vm'),handlers={},requests=[],destinations=[],opened=[],bridged=[],picker=[],queueBodies=[];
 const button={disabled:false},status={textContent:''},popup={closed:false,document:{body:{}},focus(){},close(){this.closed=true;}};
 const document={getElementById:id=>id==='phoneBackupOpen'?(hasSettings?button:null):id==='phoneBackupLaunchStatus'?status:null,addEventListener:(name,handler)=>{handlers['document:'+name]=handler;}};
 button.addEventListener=(name,handler)=>{handlers['settings:'+name]=handler;};
 const localFetch=async(url,options={})=>{requests.push(url);if(options.method==='POST'){queueBodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({changed:1})};}return {ok:true,json:async()=>({sourceToken:'queue-source'})};};
 const box={URL,URLSearchParams,document,addEventListener:(name,handler)=>{handlers[name]=handler;},open:(...args)=>{opened.push(args);return blocked?null:popup;},location:{origin:'http://192.168.100.1:8765',assign:target=>destinations.push(target)},BVSourceManager:{ready:Promise.resolve(),source:{kind:'car',fetch:localFetch},fetch:localFetch},BVCarBackupBridge:{open:async(ids,window)=>{if(bridgeFailure)throw Error('bridge failed');bridged.push({ids:[...ids],window});}},BVRemoteBackupPage:{open:async(...args)=>picker.push(args)}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../recorder/files/mobile-web/phone-backup-launch'),'utf8'),box);handlers.DOMContentLoaded();return {handlers,requests,destinations,opened,bridged,popup,picker,queueBodies,button,status,box};
}
const selectedId='8136e19b-d2fb-4c10-9f55-634ea298980e';
test('popup is opened during user gesture before awaiting source readiness, without navigating or re-pairing',async()=>{const h=launchHarness();let resolve;h.box.BVSourceManager.ready=new Promise(r=>resolve=r);const popup=h.box.BVPhoneBackupLaunch.preparePopup();assert.equal(h.opened.length,1);const starting=h.box.BVPhoneBackupLaunch.openQueue([selectedId],popup);assert.equal(h.bridged.length,0);resolve();assert.equal(await starting,true);assert.deepEqual(h.bridged[0].ids,[selectedId]);assert.equal(h.bridged[0].window,popup);assert.deepEqual(h.requests,[]);assert.deepEqual(h.destinations,[]);});
test('additional selections reuse the open upload window without blanking it',async()=>{const h=launchHarness(),first=h.box.BVPhoneBackupLaunch.preparePopup();await h.box.BVPhoneBackupLaunch.openQueue([selectedId],first);const second=h.box.BVPhoneBackupLaunch.preparePopup();assert.equal(second,first);assert.equal(h.opened.length,1);await h.box.BVPhoneBackupLaunch.openQueue([selectedId],second);assert.equal(h.bridged.length,2);assert.equal(first.closed,false);});
test('blocked popup and failed bridge keep original car connection/page intact',async()=>{const h=launchHarness({blocked:true});assert.equal(await h.box.BVPhoneBackupLaunch.openQueue([selectedId]),false);assert.match(h.status.textContent,/Allow pop-ups/);assert.deepEqual(h.requests,[]);assert.deepEqual(h.destinations,[]);const f=launchHarness({bridgeFailure:true});assert.equal(await f.box.BVPhoneBackupLaunch.openQueue([selectedId]),false);assert.equal(f.popup.closed,true);assert.match(f.status.textContent,/bridge failed/);assert.deepEqual(f.destinations,[]);});
test('settings action opens local recording picker and does not rotate pairing',async()=>{const h=launchHarness();await h.handlers['settings:click']();assert.equal(h.picker.length,1);assert.equal(h.opened.length,0);assert.deepEqual(h.requests,[]);});
test('selected drive passes every UUID to the bridge, while invalid input cannot open a popup',async()=>{const h=launchHarness(),ids=[selectedId,'12345678-1234-1234-1234-123456789abc'],button={disabled:false,dataset:{backupDrive:JSON.stringify(ids)}};await h.handlers['document:click']({target:{closest:selector=>selector==='[data-backup-drive]'?button:null},preventDefault(){},stopPropagation(){}});assert.deepEqual(h.bridged[0].ids,ids);assert.equal(button.disabled,false);for(const bad of [[],['bad'],[selectedId,selectedId]]){const f=launchHarness();assert.equal(await f.box.BVPhoneBackupLaunch.openQueue(bad),false);assert.equal(f.opened.length,0);assert.equal(f.requests.length,0);}});
test('sidebar and overview clip templates expose named backup actions beside locks',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(require.resolve('../recorder/files/mobile-web/app'),'utf8'),clip='8136e19b-d2fb-4c10-9f55-634ea298980e';
 for(const name of ['row','item']){
  const template=source.match(new RegExp(name+'\\.innerHTML\\s*=\\s*`([\\s\\S]*?)`;'));
  assert.ok(template,`${name} template exists`);
  const box={seg:{clip:{id:clip,locked:false},offset:0},i:0,sIdx:0,sDur:4,DriveTimeline:{format:()=>''},formatBytes:()=>'',driveIcon:()=>'',getLockSvg:()=>'',getTrashSvg:()=>''};
  const icon=source.match(/const driveIcon = name => \{([\s\S]*?)\n  \};/);
  box.driveIcon=vm.runInNewContext('(name => {'+icon[1]+'})');
  const html=vm.runInNewContext('`'+template[1]+'`',box);
  assert.doesNotMatch(html,/undefined/);
  assert.match(html,new RegExp('data-backup-recording="'+clip+'"'));
  assert.match(html,/Send to Remote Backup/);assert.match(html,/btn-lock-clip/);
 }
});

test('direct clip backup saves only that complete selection before opening its popup bridge',async()=>{
 const h=launchHarness(),popup=h.box.BVPhoneBackupLaunch.preparePopup();assert.equal(h.opened.length,1);
 assert.equal(await h.box.BVPhoneBackupLaunch.openDirect([selectedId],popup),true);
 assert.deepEqual(h.requests,['/api/v1/remote-backup','/api/v1/remote-backup/queue']);assert.deepEqual(h.queueBodies,[{action:'add',clipIds:[selectedId],sourceToken:'queue-source'}]);assert.deepEqual(h.bridged[0].ids,[selectedId]);assert.equal(h.picker.length,0);assert.deepEqual(h.destinations,[]);
});
test('failed or stale direct queue preparation cannot open an upload for another source',async()=>{
 const h=launchHarness();h.box.BVSourceManager.source.fetch=async()=>({ok:false,json:async()=>({error:'The recording is incomplete.'})});assert.equal(await h.box.BVPhoneBackupLaunch.openDirect([selectedId]),false);assert.equal(h.bridged.length,0);assert.equal(h.popup.closed,true);assert.match(h.status.textContent,/incomplete/);
 const f=launchHarness();let release;f.box.BVSourceManager.source.fetch=()=>new Promise(resolve=>release=()=>resolve({ok:true,json:async()=>({sourceToken:'old'})}));
 const pending=f.box.BVPhoneBackupLaunch.openDirect([selectedId]);await new Promise(r=>setImmediate(r));f.box.BVSourceManager.source={kind:'car'};release();assert.equal(await pending,false);assert.equal(f.bridged.length,0);assert.match(f.status.textContent,/source changed/);
});
