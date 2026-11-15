"use strict";
var fs=require('fs'),path=require('path'),crypto=require('crypto');
function location(owner){return '/var/opt/bimmervision-recorder/preferences/'+owner;}
function directory(dir,owner){var st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==owner||(st.mode&511)!==448)throw Error('Unsafe recording preference directory');}
function read(dir,owner){
 try{directory(dir,owner);}catch(e){if(e.code==='ENOENT')return undefined;throw e;}
 var fd=null;
 try{fd=fs.openSync(path.join(dir,'recording-preference.json'),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));var st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==owner||(st.mode&511)!==384||st.size>1024)throw Error('Unsafe recording preference file');var value=JSON.parse(fs.readFileSync(fd,'utf8'));if(!value||typeof value.continuous!=='boolean')throw Error('Invalid recording preference');return value.continuous;}
 catch(e){if(e.code==='ENOENT')return undefined;throw Error('Recording preference unavailable: '+e.message);}
 finally{if(fd!==null)fs.closeSync(fd);}
}
function write(dir,owner,continuous,initialize){
 if(typeof continuous!=='boolean')throw Error('Invalid recording preference');
 directory(dir,owner);var existing=read(dir,owner);if(existing===continuous||initialize&&existing!==undefined)return;
 var file=path.join(dir,'recording-preference.json'),tmp=file+'.tmp-'+crypto.randomBytes(8).toString('hex'),fd=null;
 try{fd=fs.openSync(tmp,'wx',384);fs.writeFileSync(fd,JSON.stringify({continuous:continuous})+'\n');if(process.getuid()!==owner)fs.fchownSync(fd,owner,owner);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;directory(dir,owner);if(initialize){try{fs.linkSync(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;}}else fs.renameSync(tmp,file);fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}catch(e){if(e.code!=='EINVAL'&&e.code!=='ENOTSUP')throw e;}}
 finally{if(fd!==null)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
module.exports={location:location,read:read,write:write};
