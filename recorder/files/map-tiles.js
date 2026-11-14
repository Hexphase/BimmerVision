'use strict';
var fs=require('fs'),path=require('path'),https=require('https'),io=require('./io');
function MapTiles(options){options=options||{};this.cache=options.cache||path.join(fs.realpathSync(require('os').tmpdir()),'bimmervision-osm-standard-v1');this.request=options.request||https.get;this.pending=new Map();}
function validPNG(b){return b.length>=24&&b.slice(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));}
MapTiles.prototype.read=async function(z,x,y,referer){
 z=Number(z);x=Number(x);y=Number(y);
 if(!Number.isInteger(z)||z<0||z>19||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=Math.pow(2,z)||y>=Math.pow(2,z))throw Error('Invalid map tile');
 var key=z+'-'+x+'-'+y,file=path.join(this.cache,key+'.png'),self=this;
 await io.ensureDir(this.cache);
 try{var st=await io.safePath(file,'file');if(Date.now()-st.mtimeMs<7*86400000){var cached=await io.readFile(file);if(validPNG(cached))return cached;}}catch(e){if(e.code!=='ENOENT')throw e;}
 if(this.pending.has(key))return this.pending.get(key);
 if(this.pending.size>=8)throw Error('Map requests busy');
 var work=new Promise(function(resolve,reject){
  var headers={'User-Agent':'BimmerVision/0.2 (recording viewer)'};
  if(referer)headers.Referer=referer;
  var request=self.request('https://tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png',{headers:headers},function(res){
   if(res.statusCode!==200||!/^image\/png\b/.test(res.headers['content-type']||'')){res.resume();reject(Error('Map tiles unavailable'));return;}
   var chunks=[],length=0;
   res.on('data',function(b){length+=b.length;if(length>1048576){request.destroy();reject(Error('Map tile too large'));}else chunks.push(b);});
   res.on('error',reject);
   res.on('end',function(){var b=Buffer.concat(chunks);if(!validPNG(b))reject(Error('Invalid map image'));else resolve(b);});
  });
  request.setTimeout(8000,function(){request.destroy();reject(Error('Map tile timed out'));});
  request.on('error',reject);
 }).then(async function(b){await io.writeFile(file+'.new',b);await io.rename(file+'.new',file);return b;});
 this.pending.set(key,work);
 try{return await work;}finally{this.pending.delete(key);}
};
module.exports={MapTiles:MapTiles};
