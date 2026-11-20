'use strict';
// Persist intent before touching finalized manifests. Monotonic timestamps are
// meaningful only in the named kernel boot; unknown platforms use a process ID.
var fs=require('fs'),path=require('path'),crypto=require('crypto'),io=require('./io');
var fallback='process-'+crypto.randomBytes(16).toString('hex');
function timelineId(){try{var id=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();if(/^[a-f0-9-]{36}$/i.test(id))return 'linux-'+id;}catch(ignore){}return fallback;}
function validWindow(w){return w&&typeof w.timelineId==='string'&&w.timelineId.length<=128&&Number.isSafeInteger(w.startUs)&&w.startUs>=0&&Number.isSafeInteger(w.endUs)&&w.endUs>=w.startUs&&Number.isSafeInteger(w.revision)&&w.revision>0;}
async function loadState(root){var file=path.join(root,'horn-lock-windows.json');try{var st=await io.safePath(file,'file');if(st.size>1048576)throw Error('Horn protection metadata exceeds limit');var data=JSON.parse(await io.readFile(file,'utf8'));if(data.schemaVersion!==1||!Array.isArray(data.windows)||data.windows.length>4096||!data.windows.every(validWindow))throw Error('Invalid horn protection metadata');return data;}catch(e){if(e.code==='ENOENT')return {schemaVersion:1,windows:[]};throw e;}}
async function load(root){return (await loadState(root)).windows;}
function apply(m,windows){if(typeof m.timelineId!=='string'||!Number.isSafeInteger(m.startMonotonicUs)||!Number.isSafeInteger(m.endMonotonicUs)||m.endMonotonicUs<m.startMonotonicUs)return false;var revision=0;windows.forEach(function(w){if(w.timelineId===m.timelineId&&m.startMonotonicUs<=w.endUs&&m.endMonotonicUs>=w.startUs)revision=Math.max(revision,w.revision);});if(!revision||revision<=(m.hornLockRevision||0))return false;m.locked=true;m.hornLockRevision=revision;return true;}
function HornLocks(o){this.library=o.library;this.root=this.library.root;this.guard=this.library.guard;this.timelineId=o.timelineId||timelineId();this.nowUs=o.nowUs||require('./recorder').nowUs;this.windows=[];this.revision=0;this.dirty=false;this.sources=Object.create(null);this.pending=false;this.change=0;}
HornLocks.prototype.init=async function(){await this.guard.check();var data=await loadState(this.root);this.windows=data.windows;if(data.sourceTimelineId===this.timelineId&&data.sources&&typeof data.sources==='object'&&!Array.isArray(data.sources)){var self=this;Object.keys(data.sources).forEach(function(k){var v=data.sources[k];if(k.length<=200&&v&&Number.isSafeInteger(v.atUs)&&v.atUs>=0&&typeof v.pressed==='boolean')self.sources[k]=v;});}this.pending=this.windows.length>0;this.revision=this.windows.reduce(function(n,w){return Math.max(n,w.revision);},0);this.library.hornLocks=this;await this.library.lock(async function(){});};
HornLocks.prototype.observe=function(e,atUs){
 var source,value,sampleUs,valid=false,now=this.nowUs();
 if(e&&e.type==='horn'){source='BDC.HUPE_TASTER';value=e.pressed;sampleUs=atUs;valid=e.valid===true;}
 else if(e&&e.type==='telemetry'&&e.fields&&e.fields.horn){var f=e.fields.horn;source=f.source;value=f.value;sampleUs=f.atUs;valid=f.valid===true;}
 if(!valid||typeof source!=='string'||!source||source.length>200||typeof value!=='boolean'||!Number.isSafeInteger(sampleUs)||sampleUs<0||sampleUs>now||now-sampleUs>2000000)return false;
 if(source.indexOf('BDC.HUPE_TASTER')>=0)source='BDC.HUPE_TASTER';
 var old=this.sources[source];if(old&&sampleUs<=old.atUs)return false;this.sources[source]={atUs:sampleUs,pressed:value};if(!old||old.pressed!==value){this.dirty=true;this.pending=true;this.change++;}
 if(!value||old&&old.pressed)return false;
 this.windows.push({timelineId:this.timelineId,startUs:Math.max(0,sampleUs-30000000),endUs:sampleUs+30000000,revision:++this.revision});this.dirty=true;this.pending=true;return true;
};
HornLocks.prototype.apply=function(m){return apply(m,this.windows);};
// Called only under Library's serial lock, including before destructive changes.
// Readers keep their immutable snapshot until release; the next pass locks them.
HornLocks.prototype.reconcile=async function(){
 if(!this.pending&&!this.dirty)return;await this.guard.check();if(this.dirty){if(this.windows.length>4096)throw Error('Horn protection window limit reached');var snapshot=this.windows.slice(),change=this.change;await io.atomicJSON(path.join(this.root,'horn-lock-windows.json'),{schemaVersion:1,windows:snapshot,sourceTimelineId:this.timelineId,sources:Object.assign({},this.sources)});await io.syncDir(this.root);/* Observations can arrive during fsync; retain their dirty flag. */this.dirty=this.change!==change;}
 if(this.dirty)return this.reconcile();
 var names=await io.readdir(this.root),lib=this.library,deferred=false,manifests=new Map(),changed=new Set();
 for(var i=0;i<names.length;i++){
  var id=names[i];if(!require('./library').UUID.test(id))continue;var m;
  try{m=await lib.manifest(id);}catch(e){
   // A damaged old manifest must not stop healthy recording/finalization.
   // Mount loss still aborts. Library already refuses deletion of unreadable
   // metadata, and durable window intent remains for repair/restart recovery.
   await this.guard.check();continue;
  }
  manifests.set(id,m);if(this.apply(m))changed.add(id);
 }
 // A protected dependent clip needs its retained decoder prefix as well. A
 // revision already acknowledged by manual unlock must never be reapplied.
 manifests.forEach(function(root){
  if(root.locked!==true||!Number.isSafeInteger(root.hornLockRevision)||root.hornLockRevision<=0)return;
  var revision=root.hornLockRevision,current=root,seen=new Set([root.id]);
  while(current.requiresPrevious===true&&current.previousId){
   var previousId=current.previousId;if(seen.has(previousId))break;seen.add(previousId);
   var previous=manifests.get(previousId);if(!previous)break;
   if(revision>(previous.hornLockRevision||0)){previous.locked=true;previous.hornLockRevision=revision;previous.hornLockDependency=true;changed.add(previousId);}
   current=previous;
  }
 });
 var modified=Array.from(changed);
 for(var j=0;j<modified.length;j++){var cid=modified[j];if(lib.readers[cid]){deferred=true;continue;}await this.guard.check();await io.atomicJSON(path.join(this.root,cid,'manifest.json'),manifests.get(cid));await io.syncDir(path.join(this.root,cid));lib.invalidateSummary();}
 this.pending=this.dirty||deferred;if(this.dirty)return this.reconcile();
};
module.exports={HornLocks:HornLocks,timelineId:timelineId,load:load,apply:apply};
