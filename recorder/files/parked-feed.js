'use strict';
// Runs as nobody with the video group. Only inherited recording/frame descriptors are used.
const fs=require('fs'), cp=require('child_process'), path=require('path');
const archive=require('./archive'), AccessUnits=require('./rtp').AccessUnits;
const io=require('./io');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const prefix=Buffer.from([0,0,0,1]);
async function feed(options) {
 const child=cp.spawn(path.join(__dirname,'parked-decoder'),[],{stdio:['pipe','pipe','inherit',3]});
 let failure=null, closed=false, paused=false, lastReport=-1000;
 child.stdin.on('error',e=>{failure=e});
 child.on('error',e=>{failure=e});
 child.on('close',code=>{closed=true;if(code)failure=Error('Decoder unavailable ('+code+')')});
 const lines=require('readline').createInterface({input:child.stdout});
 let lastQuad;
 lines.on('line',line=>{
   const match=/^(\d+) ([01])$/.exec(line);
   if(!match||!process.connected)return;
   const ms=Number(match[1]),quad=match[2]==='1';
   if(ms-lastReport<100&&quad===lastQuad)return;
   lastReport=ms;lastQuad=quad;process.send({position:ms/1000,quad:quad});
 });
 process.on('message',m=>{paused=!!m.paused});
 process.on('disconnect',()=>{child.kill();process.exit(0)});
 function write(b){return new Promise((resolve,reject)=>child.stdin.write(b,e=>e?reject(e):resolve()))}
 let phase=0, pending=[],pendingSize=0, started=false, origin=null, firstPosition=0;
 const now=()=>{const t=process.hrtime();return t[0]*1000+t[1]/1e6};
 async function output(unit,ms,phase,render) {
   if(render){
     if(origin===null){origin=now();firstPosition=ms}
     while(true){
       if(failure||closed)throw failure||Error('Decoder closed');
       if(paused&&lastReport>=0){const start=now();await delay(40);origin+=now()-start;continue}
       const wait=origin+(ms-firstPosition)-now();
       if(wait<=0)break;
       await delay(Math.min(40,wait));
     }
   }
   const nals=unit.idr?[unit.sps,unit.pps,Buffer.from([6,6,1,0xc4,0x80])].concat(unit.nals):unit.nals;
   const size=nals.reduce((n,b)=>n+b.length+4,0);
   const packet=Buffer.allocUnsafe(12+size);
   packet.writeUInt32LE(size,0);packet.writeUInt32LE(phase,4);packet.writeUInt32LE(ms,8);
   let p=12;for(const nal of nals){prefix.copy(packet,p);nal.copy(packet,p+4);p+=4+nal.length}
   await write(packet);
 }
 let single=false;
 const queue=[], decoder=new AccessUnits(u=>queue.push(u));
 async function readFile(fd) {
   const head=await io.readAt(fd,16,0);if(archive.checkHeader(head))throw Error('Invalid recording');
   let offset=16,carry=Buffer.alloc(0);
   for(;;){
     if(failure||closed)throw failure||Error('Decoder closed');
     const bytes=await io.readAt(fd,256*1024,offset);offset+=bytes.length;
     if(!bytes.length){if(carry.length)throw Error('Incomplete recording');break}
     const chunk=carry.length?Buffer.concat([carry,bytes]):bytes;
     let i=0;
     while(i+24<=chunk.length){
       const r=archive.recordHeader(chunk.slice(i,i+24)),next=i+24+r.payloadBytes;if(next>chunk.length)break;
       if(r.type===2&&r.payloadBytes<262144){
         const payload=chunk.slice(i+24,next);
         if(payload.indexOf('ICAM.XView3D')!==-1&&archive.crc32(payload)===r.crc){
           let event;try{event=JSON.parse(payload.toString())}catch(e){}
           if(event&&event.type==='camera-control'&&event.source==='ICAM.XView3D'){
             const hex=event.currentStateHex||'';
             single=event.state==='unavailable'||!(/^(32|33|34)32(07|09|0a)$/i.test(hex));
           }
         }
       }else if(r.type===1){
         const payload=chunk.slice(i+24,next);
         if(archive.crc32(payload)!==r.crc)throw Error('Recording checksum mismatch');
         decoder.push(payload,r.atUs);
       }
       i=next;
       while(queue.length){
         const u=queue.shift(),ms=Math.max(0,Math.round((u.atUs-options.start)/1000));
         const pair=single?2:phase%2;phase++;
         if(!started&&u.atUs<options.start+options.seek*1000000){
           if(u.idr){pending=[];pendingSize=0}
           pending.push({unit:u,phase:pair});pendingSize+=u.nals.reduce((n,b)=>n+b.length,0);
           if(pendingSize>32*1024*1024)throw Error('No recent recovery frame');
           continue;
         }
         if(!started){
           for(const item of pending)await output(item.unit,0,3,false);
           pending=[];started=true;
         }
         await output(u,ms,pair,true);
       }
     }
     carry=chunk.slice(i);
   }
 }
 try{
   if(options.previous)await readFile(5);
   await readFile(4);child.stdin.end();
   while(!closed&&!failure)await delay(10);
   if(failure)throw failure;
   if(!started)throw Error('No playable frames');
 }finally{child.kill()}
}
if(require.main===module)process.once('message',opts=>feed(opts).then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1)}));
