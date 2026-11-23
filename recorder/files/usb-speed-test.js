'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto'),io=require('./io');
var MIB=1024*1024,BLOCK=4*MIB,TOTAL=16*MIB,RESERVE=64*MIB;
async function measure(guard,space,now,checkIntent){
 var root=guard.mount,free=await space(root);
 if(free.free<TOTAL+RESERVE)throw Error('Speed test needs at least 80 MiB free.');
 var file=path.join(root,'.bimmervision-speed-'+crypto.randomBytes(16).toString('hex')+'.tmp');
 var fd=null,opened=false,identity,began,total=0,worstFlushUs=0;
 try{
  checkIntent();
  await guard.check();
  fd=await io.open(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),384);
  opened=true;await guard.check(fd);identity=await io.fstat(fd);
  began=now();
  while(total<TOTAL){
   checkIntent();
   var data=crypto.randomBytes(BLOCK);
   await guard.check(fd);await io.writeAll(fd,data);
   await guard.check(fd);
   var start=now();await io.fsync(fd);worstFlushUs=Math.max(worstFlushUs,now()-start);
   total+=BLOCK;
   if(now()-began>=15000000)break;
  }
  await guard.check(fd);
  var rate=total/Math.max(1,now()-began),worstFlushMs=Math.round(worstFlushUs/1000);
  return {bytes:total,mbps:Math.round(rate*10)/10,worstFlushMs:worstFlushMs,
    result:rate<3?'slow':rate<10||worstFlushMs>=2000?'limited':'headroom'};
 }finally{
  if(fd!==null)try{await io.close(fd);}catch(ignore){}
  if(opened&&identity){
   await guard.check();
   var st=await io.lstat(file);
   if(st.isFile()&&st.ino===identity.ino&&st.dev===identity.dev){
    await guard.check();await io.unlink(file);
   }
  }
 }
}
module.exports={measure:measure};
