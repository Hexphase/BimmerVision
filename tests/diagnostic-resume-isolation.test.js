'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const main=require('../recorder/files/main'),{Recorder}=require('../recorder/files/recorder'),{DiagnosticSession}=require('../recorder/files/diagnostic-session');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,message){const end=Date.now()+2500;while(!fn()){assert.ok(Date.now()<end,message||'service transition timed out');await wait(20);}}
function child(){const c=new EventEmitter();c.exitCode=null;c.signalCode=null;c.stdin=new EventEmitter();c.stdin.write=()=>true;c.stdin.end=()=>{};c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=signal=>{c.signalCode=signal;c.emit('exit',0,signal);};return c;}
test('a pending diagnostic flush cannot delay recording resumption after video finalizes',async t=>{
 const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-diag-resume-'))),ram=path.join(temp,'ram'),prefs=path.join(temp,'preferences'),media=path.join(temp,'media'),drive=path.join(media,'USB'),hardware=path.join(temp,'hardware.json');
 fs.mkdirSync(media);fs.mkdirSync(drive);fs.writeFileSync(hardware,JSON.stringify({uid:process.getuid(),hardwareTest:true,adapterVerified:true}));await main.prepareControls(ram,process.getuid());
 const intent={continuous:true,transfer:{visible:false}},captures=[];let release,videoStopped=false,service;
 const heldFlush=new Promise(r=>release=r),originalFlush=DiagnosticSession.prototype.flush,originalStop=Recorder.prototype.stop;
 DiagnosticSession.prototype.flush=function(){return heldFlush;};
 Recorder.prototype.stop=async function(reason){const result=await originalStop.apply(this,arguments);if(reason==='user')videoStopped=true;return result;};
 t.after(async()=>{release();DiagnosticSession.prototype.flush=originalFlush;Recorder.prototype.stop=originalStop;try{if(service)await service.stop();}finally{fs.rmSync(temp,{recursive:true,force:true});}});
 service=await main.start({root:path.resolve(__dirname,'../recorder/files'),configFile:hardware,ramRoot:ram,preferencesRoot:prefs,cacheDir:path.join(temp,'cache'),controls:{read:async()=>({...intent}),write:async()=>{}},usbAdapters:{mediaRoot:media,readMounts:()=>'/dev/fake '+drive+' vfat rw 0 0',deviceIdentity:()=> 'fixture-usb',linkSpeed:()=>480,space:async()=>({total:1e9,used:0,free:1e9}),remount:false},spawnCamera:()=>child(),spawnMirror:()=>child(),spawnPerception:()=>child(),spawnReceiver:()=>{const c=child();captures.push(c);return c;}});
 let seq=0;function send(){const b=Buffer.alloc(22);b.write('CAMP');b.writeUInt32LE(14,4);b[8]=128;b[9]=224;b.writeUInt16BE(++seq,10);b.writeUInt32BE(seq,12);b.writeUInt32BE(1,16);b[20]=101;b[21]=136;captures[captures.length-1].stdout.emit('data',b);}
 await until(()=>captures.length===1);send();await until(()=>service.status().activeId);const oldId=service.status().activeId;
 intent.continuous=false;await until(()=>videoStopped,'video finalization did not finish');intent.continuous=true;
 await until(()=>service.status().recordingEnabled===true);await wait(750);
 assert.equal(service.status().finalizing,false,'diagnostic latency must not retain the video finalization interlock');
 send();await until(()=>service.status().activeId&&service.status().activeId!==oldId,'recording must accept new video while diagnostics remain pending');
 assert.equal(intent.continuous,true);assert.equal(service.status().error,null);
});
