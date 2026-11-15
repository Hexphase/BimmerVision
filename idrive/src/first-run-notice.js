'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto');
var message='Before you record\nTurn off other third-party apps that use the cameras.\nThey can interfere with recording and prevent\nBimmerVision from capturing all camera views.';
function Notice(directory,owner){this.directory=directory;this.owner=owner;this.file=path.join(directory,'camera-conflict-notice.json');}
Notice.prototype.checkDirectory=function(){var s=fs.lstatSync(this.directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==this.owner||(s.mode&511)!==448)throw Error('Unsafe notice directory');};
Notice.prototype.pending=function(){
 var fd=null;try{this.checkDirectory();fd=fs.openSync(this.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));var s=fs.fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==this.owner||(s.mode&511)!==384||s.size>1024)throw Error('Unsafe notice file');var v;try{v=JSON.parse(fs.readFileSync(fd,'utf8'));}catch(e){return true;}return !v||v.cameraConflictWarning!==1;}
 catch(e){if(e.code==='ENOENT')return true;throw e;}finally{if(fd!==null)fs.closeSync(fd);}
};
Notice.prototype.acknowledge=function(){
 this.checkDirectory();try{var s=fs.lstatSync(this.file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==this.owner||(s.mode&511)!==384)throw Error('Unsafe notice file');}catch(e){if(e.code!=='ENOENT')throw e;}
 var tmp=this.file+'.tmp-'+crypto.randomBytes(8).toString('hex'),fd=null;
 try{fd=fs.openSync(tmp,'wx',384);fs.writeFileSync(fd,JSON.stringify({cameraConflictWarning:1})+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=null;this.checkDirectory();fs.renameSync(tmp,this.file);fd=fs.openSync(this.directory,'r');try{fs.fsyncSync(fd);}catch(e){if(e.code!=='EINVAL'&&e.code!=='ENOTSUP')throw e;}}
 finally{if(fd!==null)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}
};
module.exports={Notice:Notice,message:message};
