'use strict';
// Read finalized archives without copying video payloads or modifying recordings.
var fs=require('fs'),io=require('./io'),path=require('path'),crypto=require('crypto'),crc32=require('./archive').crc32;
function Overview(options){this.cache=new Map();this.queue=Promise.resolve();this.generation=0;this.cacheDir=options&&options.cacheDir;}
Overview.prototype.cancel=function(){this.generation++;this.cache.clear();};
Overview.prototype.index=async function(file,manifest){
 await io.safePath(file,'file');
 var st=await io.stat(file),signature=[st.dev,st.ino,st.size,st.mtimeMs,st.ctimeMs,manifest.startMonotonicUs].join(':'),old=this.cache.get(file),self=this;
 if(old&&old.signature===signature)return old.result||{route:[],endpoints:null,routeStatus:'indexing'};
 if(this.cache.size>=128){var first=this.cache.keys().next().value;if(!this.cache.get(first).result)return {route:[],endpoints:null,routeStatus:'indexing'};this.cache.delete(first);}
 var entry={signature:signature,result:null},generation=this.generation;this.cache.set(file,entry);
 this.queue=this.queue.catch(function(){}).then(async function(){
  if(generation!==self.generation)return;
  var cacheFile=self.cacheDir&&path.join(self.cacheDir,crypto.createHash('sha256').update(file).digest('hex')+'.json');
  try{
   if(cacheFile){try{var cs=await io.safePath(cacheFile,'file');if(cs.size<=2097152){var saved=JSON.parse(await io.readFile(cacheFile,'utf8'));if(saved.signature===signature&&saved.version===2&&Array.isArray(saved.result.route)){entry.result=saved.result;return;}}}catch(ignore){}}
   entry.result=await scan(file,manifest,st.size,function(){return generation!==self.generation;});entry.result.routeStatus='ready';
   if(cacheFile&&generation===self.generation){try{await io.ensureDir(self.cacheDir);await io.atomicJSON(cacheFile,{version:2,signature:signature,result:entry.result});}catch(ignore){}}
  }catch(e){entry.result={route:[],endpoints:null,routeStatus:'unavailable'};}
 });
 return {route:[],endpoints:null,routeStatus:'indexing'};
};
async function scan(file,manifest,size,cancelled){
 var fd=await io.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 var route=[],endpoints=null,window=Buffer.alloc(0),windowAt=0,pos=16,records=0,lastTime=-1;
 async function read(at,n){if(at<windowAt||at+n>windowAt+window.length){windowAt=at;window=await io.readAt(fd,Math.min(Math.max(1048576,n),size-at),at);}return window.slice(at-windowAt,at-windowAt+n);}
 try{
  var archive=await read(0,16);
  if(archive.length!==16||archive.toString('ascii',0,4)!=='BVR1'||archive.readUInt32LE(4)!==1||archive.readUInt32LE(8)!==16)return {route:route,endpoints:endpoints};
  while(pos+24<=size&&records++<2000000){
   if(cancelled&&cancelled())throw Error('Index cancelled');
   var h=await read(pos,24);if(h.length!==24||h.toString('ascii',0,4)!=='BVRR'||h.readUInt16LE(6)!==24)break;
   var bytes=h.readUInt32LE(8),kind=h[4],atUs=h.readUInt32LE(12)+h.readUInt32LE(16)*4294967296;
   if(bytes===0||bytes>16777216||pos+24+bytes>size)break;
   if(kind===2&&bytes<=65536&&route.length<14400){
    var b=await read(pos+24,bytes),obj;
    try{obj=crc32(b)===h.readUInt32LE(20)?JSON.parse(b.toString('utf8')):null;}catch(e){obj=null;}
    if(obj&&obj.type==='telemetry'&&obj.fields){
     var f=obj.fields,lat=f.latitude,lon=f.longitude,t=(atUs-Number(manifest.startMonotonicUs))/1000000;
     if(lat&&lon&&lat.valid!==false&&lon.valid!==false&&lat.sourceValid!==false&&lon.sourceValid!==false&&typeof lat.value==='number'&&typeof lon.value==='number'&&isFinite(lat.value)&&isFinite(lon.value)&&Math.abs(lat.value)<=90&&Math.abs(lon.value)<=180&&(lat.value!==0||lon.value!==0)&&isFinite(t)&&t>=0&&t>=lastTime+.5){
      var point={at:t,latitude:lat.value,longitude:lon.value};
      if(f.speed&&f.speed.valid!==false&&typeof f.speed.value==='number'&&isFinite(f.speed.value))point.speedKph=f.speed.value;
      route.push(point);lastTime=t;
     }
    }
   }
   pos+=24+bytes;
  }
 }finally{await io.close(fd);}
 if(route.length){var first=route[0],last=route[route.length-1];endpoints={start:{latitude:first.latitude,longitude:first.longitude},end:{latitude:last.latitude,longitude:last.longitude}};}
 return {route:route,endpoints:endpoints};
}
module.exports=Overview;
