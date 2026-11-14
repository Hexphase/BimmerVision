'use strict';
var fs=require('fs'),util=require('util'),path=require('path');
var io={};['open','close','read','write','fsync','fstat','stat','lstat','realpath','mkdir','rename','readFile','writeFile','readdir','truncate','ftruncate','unlink','rmdir','chmod','chown','fchmod','fchown'].forEach(function(k){io[k]=util.promisify(fs[k]);});
// util.promisify(fs.read/write) returns {bytesRead,buffer}/{bytesWritten,buffer} on Node 8+.
io.safePath=async function(file,kind){
 var absolute=path.resolve(file),parts=absolute.split(path.sep),current=path.parse(absolute).root,st;
 for(var i=1;i<parts.length;i++){if(!parts[i])continue;current=path.join(current,parts[i]);st=await io.lstat(current);if(st.isSymbolicLink())throw Error('Symlink component rejected: '+current);if(i<parts.length-1&&!st.isDirectory())throw Error('Non-directory path component');}
 if(kind==='directory'&&(!st||!st.isDirectory()))throw Error('Expected directory');if(kind==='file'&&(!st||!st.isFile()))throw Error('Expected regular file');return st;
};
io.ensureDir=async function(file,mode){try{await io.mkdir(file,mode||448);}catch(e){if(e.code!=='EEXIST')throw e;}await io.safePath(file,'directory');};
io.writeAll=async function(fd,b,position){var done=0;while(done<b.length){var r=await io.write(fd,b,done,b.length-done,position==null?null:position+done);var n=typeof r==='number'?r:r.bytesWritten;if(!n)throw Error('Zero-byte write');done+=n;}};
io.readAt=async function(fd,size,position){var b=Buffer.alloc(size),done=0;while(done<size){var r=await io.read(fd,b,done,size-done,position+done);var n=typeof r==='number'?r:r.bytesRead;if(!n)break;done+=n;}return b.slice(0,done);};
io.atomicJSON=async function(file,value,owner){if(owner&&(!Number.isInteger(owner.uid)||owner.uid<1||!Number.isInteger(owner.gid)||owner.gid<1))throw Error("Invalid JSON owner");await io.safePath(path.dirname(file),'directory');var tmp=file+'.new',fd=await io.open(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|(fs.constants.O_NOFOLLOW||0),384);try{await io.writeAll(fd,Buffer.from(JSON.stringify(value)+'\n'));if(owner){await io.fchown(fd,owner.uid,owner.gid);await io.fchmod(fd,384);}await io.fsync(fd);}finally{await io.close(fd);}await io.rename(tmp,file);};
io.syncDir=async function(file){var fd;try{fd=await io.open(file,'r');await io.fsync(fd);}catch(e){if(e.code!=='EINVAL'&&e.code!=='ENOTSUP')throw e;}finally{if(fd!=null)await io.close(fd);}};
module.exports=io;
