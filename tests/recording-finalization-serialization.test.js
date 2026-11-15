'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{EventEmitter}=require('events');
const main=require('../recorder/files/main'),{Recorder}=require('../recorder/files/recorder'),{Perception}=require('../recorder/files/perception');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+3500;while(!fn()){assert.ok(Date.now()<end,'service transition timed out');await wait(20);}}
function child(){const c=new EventEmitter();c.exitCode=null;c.signalCode=null;c.stdin=new EventEmitter();c.stdin.write=()=>true;c.stdin.end=()=>{};c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=signal=>{c.signalCode=signal;c.emit('exit',0,signal);};return c;}
for(const failure of ['status write','helper stop'])test('a failed '+failure+' cannot release a recorder still finalizing',async t=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-finalizing-')));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const ram=path.join(temp,'ram'),prefs=path.join(temp,'preferences'),media=path.join(temp,'media'),drive=path.join(media,'USB'),hardware=path.join(temp,'hardware.json');fs.mkdirSync(media);fs.mkdirSync(drive);fs.writeFileSync(hardware,JSON.stringify({uid:process.getuid(),hardwareTest:true,adapterVerified:true}));await main.prepareControls(ram,process.getuid());
 const intent={continuous:true,transfer:{visible:false}},captures=[];let fail=false,failed=false,stopping=false,release;
 const gate=new Promise(r=>release=r),originalStop=Recorder.prototype.stop,helperStop=Perception.prototype.stop;
 Recorder.prototype.stop=async function(reason){if(reason==='user'&&!stopping){stopping=true;await gate;}return originalStop.call(this,reason);};
 Perception.prototype.stop=function(){if(failure==='helper stop'&&fail&&!failed){failed=true;return Promise.reject(Error('injected helper failure'));}return helperStop.apply(this,arguments);};
 t.after(()=>{release();Recorder.prototype.stop=originalStop;Perception.prototype.stop=helperStop;});
 const service=await main.start({root:path.resolve(__dirname,'../recorder/files'),configFile:hardware,ramRoot:ram,preferencesRoot:prefs,cacheDir:path.join(temp,'cache'),controls:{read:async()=>({...intent}),write:async status=>{if(failure==='status write'&&fail&&!failed&&status.state==='Saving last video'){failed=true;throw Error('injected status failure');}}},usbAdapters:{mediaRoot:media,readMounts:()=>'/dev/fake '+drive+' vfat rw 0 0',deviceIdentity:()=> 'fixture-usb',linkSpeed:()=>480,space:async()=>({total:1e9,used:0,free:1e9}),remount:false},spawnCamera:()=>child(),spawnMirror:()=>child(),spawnPerception:()=>child(),spawnReceiver:()=>{const c=child();captures.push(c);return c;}});
 t.after(()=>{release();return service.stop();});
 let seq=0;function send(){const p=Buffer.alloc(22);p.write('CAMP');p.writeUInt32LE(14,4);p[8]=128;p[9]=224;p.writeUInt16BE(++seq,10);p.writeUInt32BE(seq,12);p.writeUInt32BE(1,16);p[20]=101;p[21]=136;captures[captures.length-1].stdout.emit('data',p);}
 await until(()=>captures.length===1);send();await until(()=>service.status().activeId);const oldId=service.status().activeId;
 fail=true;intent.continuous=false;await until(()=>stopping&&failed);intent.continuous=true;
 await wait(800);send();await wait(80);
 assert.equal(service.status().activeId,oldId,'the old recorder must remain authoritative until USB finalization settles');
 assert.equal(service.status().state,'Saving last video');assert.equal(service.status().writeInProgress,true);assert.equal(service.status().safeToRemove,false);
 assert.equal(fs.readdirSync(path.join(drive,'BimmerVision')).filter(n=>n.endsWith('.partial')).length,1,'resume must not create a second recording while the old one writes');
 release();await until(()=>service.status().state!=='Saving last video');await service.stop();
});
