'use strict';
// Best-effort USB diagnostics, deliberately separate from the recording library.
// One instance owns one directory. log() never waits for disk; flush()/close()
// absorb I/O failures. After an I/O/guard failure create a new instance only once
// the USB has been verified again. Retention owns ONLY the filename pattern below.
var fs=require('fs'),path=require('path'),crypto=require('crypto'),io=require('./io');
var CAP=64*1024*1024,OWNED=/^bv-diagnostic-[0-9]{13}-[a-f0-9]{16}\.jsonl$/;
var SENSITIVE=/token|auth|credential|secret|password|key|certificate|cert|pairing|paircode|phonevisit|gps|latitude|longitude|vin|vehicleid|hardwareid|ssid|enrollment|cookie|bearer|tlskey/;
function size(value,fallback,max){return Number.isSafeInteger(value)&&value>0?Math.min(value,max):fallback;}
function cleanString(value){return value.slice(0,2048).replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/ig,'Bearer [redacted]').replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g,'[VIN redacted]').replace(/\b(?:token|password|secret|pairingCode)\s*[:=]\s*[^\s,;]+/ig,'[redacted]');}
function redact(value){
 var seen=new Set(),budget=16384;
 function visit(v,depth){
  if(budget<=0)return '[truncated]';budget-=16;
  if(v==null||typeof v==='boolean')return v;
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  if(typeof v==='string'){var s=cleanString(v).slice(0,Math.max(0,budget));budget-=s.length;return s;}
  if(typeof v!=='object')return undefined;
  if(depth>6)return '[depth limit]';if(seen.has(v))return '[circular]';seen.add(v);
  if(v instanceof Error)return {name:cleanString(v.name||'Error'),code:typeof v.code==='string'?cleanString(v.code):null,message:cleanString(v.message||'')};
  var out=Array.isArray(v)?[]:{},keys=Object.keys(v).slice(0,64);
  for(var i=0;i<keys.length&&budget>0;i++){
   var key=keys[i];if(SENSITIVE.test(key.replace(/[^a-z0-9]/ig,'').toLowerCase())||key==='__proto__'||key==='constructor'||key==='prototype')continue;
   var descriptor=Object.getOwnPropertyDescriptor(v,key);if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))continue;
   var next=visit(descriptor.value,depth+1);if(next!==undefined)out[key.slice(0,128)]=next;
  }
  return out;
 }
 return visit(value,0);
}
function DiagnosticLog(options){
 var o=options||{};this.directory=typeof o.directory==='string'?path.resolve(o.directory):null;this.check=o.check;
 this.maxBytes=size(o.maxBytes,CAP,CAP);this.fileBytes=size(o.fileBytes,Math.min(8*1024*1024,this.maxBytes),this.maxBytes);this.queueLimit=size(o.queueBytes,256*1024,1024*1024);
 this.queue=[];this.queuedBytes=0;this.bytes=0;this.dropped=0;this.written=0;this.error=null;this.disabled=false;this.closed=false;this.initialized=false;this.files=[];this.active=null;this.work=null;this.scheduled=null;this.syncRequested=false;this.directoryDirty=false;this.parentDirty=false;this.syncing=false;
}
DiagnosticLog.prototype.info=function(){var stopped=this.disabled&&this.closed,dirty=!stopped&&(this.directoryDirty||this.parentDirty||this.files.some(function(f){return f.dirty;}));return {dirty:dirty,syncing:this.syncing,pendingDurability:!!(this.work||this.queuedBytes||dirty||this.syncRequested||this.syncing),bytes:this.bytes,writing:!!this.work,queuedBytes:this.queuedBytes,dropped:this.dropped,written:this.written,error:this.error,disabled:this.disabled,closed:this.closed,maxBytes:this.maxBytes,fileBytes:this.fileBytes};};
DiagnosticLog.prototype.log=function(eventName,data){
 try{
  if(this.closed||this.disabled||typeof eventName!=='string'||!eventName){this.dropped++;return false;}
  var row=Buffer.from(JSON.stringify({at:Date.now(),event:cleanString(eventName).slice(0,96),data:redact(data)})+'\n');
  if(row.length>this.fileBytes||row.length+this.queuedBytes>this.queueLimit){this.dropped++;return false;}
  this.queue.push(row);this.queuedBytes+=row.length;this.kick();return true;
 }catch(ignore){this.dropped++;return false;}
};
DiagnosticLog.prototype.kick=function(){var self=this;if(this.scheduled||this.work||this.disabled)return;this.scheduled=setImmediate(function(){self.scheduled=null;self.run();});};
DiagnosticLog.prototype.fail=function(e){this.disabled=true;this.syncRequested=false;this.error=String(e&&e.code||'IO_ERROR')+': '+cleanString(String(e&&e.message||e)).slice(0,512);this.dropped+=this.queue.length;this.queue=[];this.queuedBytes=0;};
DiagnosticLog.prototype.guard=async function(){if(!this.directory||typeof this.check!=='function')throw Error('Verified USB directory and guard required');if(this.disabled)throw Error('Diagnostic logging stopped');await this.check();if(this.disabled)throw Error('Diagnostic logging stopped');};
DiagnosticLog.prototype.guardDirectory=async function(){await this.guard();await io.safePath(this.directory,'directory');if(this.disabled)throw Error('Diagnostic logging stopped');};
DiagnosticLog.prototype.initialize=async function(){
 await this.guard();await io.safePath(path.dirname(this.directory),'directory');
 // mkdir is guarded separately: the parent USB may disappear between reads.
 await this.guard();try{await io.mkdir(this.directory,448);this.parentDirty=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 await this.guardDirectory();var names=await io.readdir(this.directory);
 for(var i=0;i<names.length;i++){
  if(!OWNED.test(names[i]))continue;var file=path.join(this.directory,names[i]),st=await io.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)continue;
  this.files.push({name:names[i],size:st.size,ino:st.ino,dev:st.dev,mtime:st.mtime.getTime()});this.bytes+=st.size;
 }
 this.files.sort(function(a,b){return a.mtime-b.mtime||a.name.localeCompare(b.name);});
 await this.prune(0);this.initialized=true;
};
DiagnosticLog.prototype.verify=async function(file){
 await this.guardDirectory();var st=await io.lstat(path.join(this.directory,file.name));
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.ino!==file.ino||st.dev!==file.dev||st.size!==file.size)throw Error('Diagnostic file changed outside logger');return st;
};
DiagnosticLog.prototype.prune=async function(addBytes){
 while(this.bytes+addBytes>this.maxBytes){
  var index=this.files.findIndex(function(f){return f!==this.active;},this);if(index<0)throw Error('Diagnostic retention capacity exhausted');var file=this.files[index];
  await this.verify(file);await this.guard();await io.unlink(path.join(this.directory,file.name));this.directoryDirty=true;this.bytes-=file.size;this.files.splice(index,1);
 }
};
DiagnosticLog.prototype.create=async function(){
 await this.guardDirectory();var name='bv-diagnostic-'+Date.now()+'-'+crypto.randomBytes(8).toString('hex')+'.jsonl',file=path.join(this.directory,name),fd;
 await this.guard();fd=await io.open(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),384);
 try{var st=await io.fstat(fd);if(!st.isFile()||st.nlink!==1)throw Error('Invalid diagnostic file');this.active={name:name,size:0,ino:st.ino,dev:st.dev,mtime:st.mtime.getTime()};this.files.push(this.active);this.directoryDirty=true;}finally{await io.close(fd);}
};
DiagnosticLog.prototype.drain=async function(){
 if(!this.initialized)await this.initialize();
 while(this.queue.length&&!this.disabled){
  if(!this.active||this.active.size+this.queue[0].length>this.fileBytes){this.active=null;await this.create();}
  var batch=[],length=0,room=this.fileBytes-this.active.size;
  for(var i=0;i<this.queue.length&&length+this.queue[i].length<=room;i++){batch.push(this.queue[i]);length+=this.queue[i].length;}
  await this.prune(length);await this.verify(this.active);var fd;
  try{
   await this.guard();fd=await io.open(path.join(this.directory,this.active.name),fs.constants.O_WRONLY|fs.constants.O_APPEND|(fs.constants.O_NOFOLLOW||0));
   var st=await io.fstat(fd);if(!st.isFile()||st.nlink!==1||st.ino!==this.active.ino||st.dev!==this.active.dev||st.size!==this.active.size)throw Error('Diagnostic append target changed');
   await this.guardDirectory();this.active.dirty=true;await io.writeAll(fd,Buffer.concat(batch,length));
   this.active.size+=length;this.bytes+=length;this.written+=batch.length;this.queue.splice(0,batch.length);this.queuedBytes=Math.max(0,this.queuedBytes-length);
  }finally{if(fd!=null)await io.close(fd);}
 }
 if(this.syncRequested){this.syncRequested=false;await this.sync();}
};
// Only an explicit flush/close incurs fsync, including retained rotated files.
DiagnosticLog.prototype.sync=async function(){
 this.syncing=true;try{
 for(var i=0;i<this.files.length;i++){
  var file=this.files[i];if(!file.dirty)continue;await this.verify(file);var fd;
  try{
   await this.guard();fd=await io.open(path.join(this.directory,file.name),fs.constants.O_WRONLY|(fs.constants.O_NOFOLLOW||0));
   var st=await io.fstat(fd);if(!st.isFile()||st.nlink!==1||st.ino!==file.ino||st.dev!==file.dev||st.size!==file.size)throw Error('Diagnostic sync target changed');
   await this.guardDirectory();await io.fsync(fd);file.dirty=false;
  }finally{if(fd!=null)await io.close(fd);}
 }
 if(this.directoryDirty){await this.guardDirectory();await io.syncDir(this.directory);this.directoryDirty=false;}
 if(this.parentDirty){await this.guardDirectory();await io.syncDir(path.dirname(this.directory));this.parentDirty=false;}
 }finally{this.syncing=false;}
};
DiagnosticLog.prototype.run=function(){
 var self=this;if(this.work)return this.work;if(this.disabled)return Promise.resolve();
 this.work=this.drain().catch(function(e){if(!(self.closed&&self.disabled))self.fail(e);}).then(function(){self.work=null;if(self.queue.length&&!self.disabled)self.kick();});return this.work;
};
DiagnosticLog.prototype.flush=async function(){
 if(this.disabled)return;
 if(this.scheduled){clearImmediate(this.scheduled);this.scheduled=null;}
 do{this.syncRequested=true;await this.run();}while((this.queue.length||this.syncRequested)&&!this.disabled);
};
// Pause discards unsaved diagnostics by policy. An I/O already issued may
// finish, but no queued append, retention or durability task starts afterward.
DiagnosticLog.prototype.stop=function(){this.closed=true;this.disabled=true;if(this.scheduled)clearImmediate(this.scheduled);this.scheduled=null;this.dropped+=this.queue.length;this.queue=[];this.queuedBytes=0;this.syncRequested=false;return this.work||Promise.resolve();};
DiagnosticLog.prototype.close=async function(){this.closed=true;await this.flush();};
module.exports={DiagnosticLog:DiagnosticLog,redact:redact};
