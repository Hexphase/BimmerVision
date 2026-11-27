'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const io=require('./io'),clock=require('./recorder').nowUs;
function fresh(t,now,limit){return Number.isFinite(t)&&now>=t&&now-t<=limit}
function allowed(status,gear,now){
 const speed=status.telemetry&&status.telemetry.speed;
 return !!(gear&&gear.park&&fresh(gear.at,now,2000000)&&speed&&speed.valid===true&&speed.value===0&&
   fresh(speed.atUs,now,2000000)&&status.recordingEnabled===false&&!status.activeId&&!status.finalizing&&
   !status.writeInProgress&&!status.recovering&&!status.deleting&&status.drive);
}
class ParkedPlayback{
 constructor(uid){this.uid=uid;this.epoch=0;this.state={};this.gear=null;this.attempt=0}
 async listen(){
   if(this.proxy||this.connecting||clock()-this.attempt<3000000)return;
   this.attempt=clock();this.connecting=true;
   const epoch=this.gearEpoch||0;
   let proxy;
   try{
     const file='/var/opt/public/oap/oap_'+this.uid+'/someipInterfaces/de_bmw_infrastructure_VehicleInformation.json';
     const cfg=JSON.parse(await io.readFile(file,'utf8'));
     const field=cfg.fields.DataPowerTrain2;
     if(cfg.serviceId!==5430||!field.schema.e.some(m=>m.n==='statusGearSelectionDrive'&&m.e&&m.e.P===3))throw Error('Unrecognized gear signal');
     cfg.methods={};cfg.events={};cfg.fields={DataPowerTrain2:field};
     proxy=await require('/usr/lib/someip.node').buildProxy(cfg,'1');await proxy.init();
     await proxy.subscribe({name:'DataPowerTrain2',onReceive:v=>{
       if(epoch!==(this.gearEpoch||0))return;
       this.gear={park:!!v&&v.statusGearSelectionDrive==='P',at:clock()};
       if(!this.gear.park&&this.key)this.block();
     }});
     if(epoch===(this.gearEpoch||0)){this.proxy=proxy;proxy=null}
   }catch(e){}finally{if(proxy)await proxy.shutdown().catch(()=>{});this.connecting=false}
 }
 stop(){
   this.epoch++;this.key=null;
   if(this.worker){this.worker.kill();this.worker=null}
   if(this.file){try{fs.unlinkSync(this.file)}catch(e){}this.file=null}
   this.state={};
 }
 block(){const key=this.key;this.stop();this.denied=key;this.state={message:'Playback stopped. Select the recording again in Park.'}}
 close(){this.stop();this.denied=null;this.gearEpoch=(this.gearEpoch||0)+1;this.gear=null;
   if(this.proxy){this.proxy.shutdown().catch(()=>{});this.proxy=null}}
 available(status){return allowed(status,this.gear,clock())}
 async releasePlayer(){
   const closed=this.workerClosed;
   this.stop();
   if(closed)await closed;
 }
 update(cmd,status,lib){
   const now=clock();
   if(!cmd||!fresh(cmd.beat,now,1800000)||!lib||cmd.volume!==status.volumeToken){
     if(this.key||this.file||this.denied){this.stop();this.denied=null;}
     if(lib&&status.recordingEnabled===false)this.listen().catch(()=>{});
     else if(this.proxy||this.gear)this.close();
     this.state={ready:!!lib&&this.available(status)};return;
   }
   this.listen().catch(()=>{});
   if(!cmd.id){if(this.key)this.stop();this.denied=null;
     this.state={ready:allowed(status,this.gear,now)};return}
   if(typeof cmd.key!=='string'||!/^[a-f0-9]{24}$/.test(cmd.key)||!Number.isFinite(cmd.seek)||cmd.seek<0)return this.close();
   if(!allowed(status,this.gear,now)){if(this.key)this.block();else {this.denied=cmd.key;this.state={message:'Select Park and disable recording.'}}return}
   if(cmd.key===this.denied)return;
   if(cmd.key!==this.key){
     this.stop();this.key=cmd.key;this.paused=cmd.paused===true;
     this.state={key:cmd.key,position:cmd.seek,loading:true};
     this.start(cmd,lib,this.epoch).catch(()=>{if(this.key===cmd.key){this.stop();this.denied=cmd.key;this.state={message:'This recording could not be played.'}}});
   }else if(this.paused!==(cmd.paused===true)){
     this.paused=cmd.paused===true;if(this.worker&&this.worker.connected)this.worker.send({paused:this.paused},()=>{});
   }
 }
 async start(cmd,lib,epoch){
   const manifest=await lib.manifest(lib.id(cmd.id));
   if(manifest.complete!==true||!Number.isFinite(manifest.startMonotonicUs)||!(manifest.durationSeconds>0))throw Error('Invalid clip');
   const ids=[cmd.id];if(manifest.requiresPrevious&&manifest.previousId)ids.push(lib.id(manifest.previousId));
   const release=await lib.acquireRecordings(ids),fds=[];let worker;
   try{
     for(const id of ids)fds.push(await io.open(await lib.resolve(id,'capture.bvr'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW));
     if(epoch!==this.epoch)return;
     this.file='/dev/shm/mgu-video-bv-'+crypto.randomBytes(12).toString('hex')+'.frame';
     const frame=fs.openSync(this.file,'wx+',384);fds.unshift(frame);
     worker=cp.spawn(process.execPath,[path.join(__dirname,'parked-feed.js')],{uid:65534,gid:44,stdio:['ignore','ignore','ignore'].concat(fds,'ipc')});
     this.worker=worker;this.workerClosed=new Promise(resolve=>worker.once('close',resolve));let wrote=false;
     worker.on('message',msg=>{if(epoch===this.epoch&&Number.isFinite(msg.position)&&msg.position>=cmd.seek-.1){
       wrote=true;this.state={key:cmd.key,position:msg.position,quad:msg.quad===true,file:this.file};}});
     worker.on('error',()=>{});
     worker.once('close',code=>{release();if(epoch!==this.epoch)return;
       this.worker=null;this.state=code===0&&wrote?Object.assign({},this.state,{ended:true}):{message:'Hardware video playback unavailable for this recording.'};
     });
     worker.send({previous:ids.length>1,start:manifest.startMonotonicUs,seek:Math.min(cmd.seek,Math.max(0,manifest.durationSeconds-.1))},()=>{});
     if(this.paused)worker.send({paused:true},()=>{});
   }finally{for(const fd of fds)await io.close(fd);if(!worker)release()}
 }
}
module.exports={ParkedPlayback,allowed};
