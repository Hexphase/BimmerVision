'use strict';
var fs=require('fs'),path=require('path'),cp=require('child_process'),util=require('util'),io=require('./io');
function decode(s){return s.replace(/\\([0-7]{3})/g,function(_,o){return String.fromCharCode(parseInt(o,8));});}
function entries(text){return String(text).trim().split('\n').filter(Boolean).map(function(line){var p=line.split(/\s+/);return {device:decode(p[0]),mount:decode(p[1]||''),type:p[2],flags:(p[3]||'').split(',')};});}
function noLinks(file){var p=path.resolve(file),parts=p.split('/'),current='/';parts.slice(1).forEach(function(part){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('Symlink mount rejected');});return fs.statSync(p);}
function blockBase(device){return path.basename(device).replace(/\d+$/,'');}
function linkSpeedMbps(device){
 try{
  var base=blockBase(device),cur=fs.realpathSync(path.join('/sys/block',base,'device'));
  for(var i=0;i<12;i++){
   try{var speed=Number(String(fs.readFileSync(path.join(cur,'speed'),'utf8')).trim());if(speed>0)return speed;}catch(e){}
   var parent=path.dirname(cur);if(parent===cur)break;cur=parent;
  }
 }catch(e){}
 return null;
}
function identity(device){if(device.indexOf('/dev/')!==0)throw Error('Not a block device');var real=fs.realpathSync(device),st=fs.statSync(real);if(!st.isBlockDevice())throw Error('Not a block device');var sys=fs.realpathSync('/sys/class/block/'+path.basename(real));if(!/\/usb[0-9]+\//.test(sys))throw Error('Not a physical USB device');return real+':'+st.rdev+':'+sys;}
function adapters(options){var o=options||{};return {mediaRoot:o.mediaRoot||'/media',readMounts:o.readMounts||function(){return fs.readFileSync('/proc/mounts','utf8');},deviceIdentity:o.deviceIdentity||identity,linkSpeed:o.linkSpeed||linkSpeedMbps,space:o.space||space,remount:o.remount};}
function mounted(mount,a){var root=path.resolve(a.mediaRoot),m=path.resolve(mount);if(m.indexOf(root+'/')!==0)throw Error('Volume must be directly mounted below '+root);var e=entries(a.readMounts()).filter(function(e){return e.mount===m;});if(e.length!==1||e[0].flags.indexOf('rw')===-1)throw Object.assign(Error('Writable USB mount unavailable'),{code:e.length!==1?'MOUNT_MISSING_OR_AMBIGUOUS':'MOUNT_READ_ONLY'});return e[0];}
function verify(mount,options){
 var a=adapters(options),m=path.resolve(mount),entry=mounted(m,a),st=noLinks(m);if(!st.isDirectory())throw Error('Mount is not a directory');var speed=a.linkSpeed(entry.device),id=a.deviceIdentity(entry.device),dev=st.dev,ino=st.ino;
 return {mount:m,device:entry.device,linkSpeedMbps:speed,identity:id,check:function(fd){
  var next=mounted(m,a),now=noLinks(m);if(next.device!==entry.device||a.deviceIdentity(next.device)!==id||now.dev!==dev||now.ino!==ino)throw Error('USB mount replaced or changed');
  if(fd!=null)return io.fstat(fd).then(function(s){if(s.dev!==dev)throw Error('Recording descriptor is not on selected USB');});
 }};
}
async function space(mount){var r=await util.promisify(cp.execFile)('/bin/df',['-Pk',mount],{timeout:2000,maxBuffer:16384});var line=r.stdout.trim().split('\n').pop().trim().split(/\s+/);var total=Number(line[1])*1024,used=Number(line[2])*1024,free=Number(line[3])*1024;if(!isFinite(total)||!isFinite(used)||!isFinite(free))throw Error('Cannot read USB space');return {total:total,used:used,free:free};}
var WRITABLE={vfat:1,msdos:1,exfat:1,texfat:1,ntfs:1,fuseblk:1};
function defaultRemount(mount){return util.promisify(cp.execFile)('/bin/mount',['-o','remount,rw',mount],{timeout:4000,maxBuffer:4096});}
function usbBlockInventory(){
 try{
  return fs.readdirSync('/sys/class/block').filter(function(name){return /^sd[a-z]+[0-9]*$/.test(name);}).filter(function(name){
   try{return /\/usb[0-9]+\//.test(fs.realpathSync('/sys/class/block/'+name));}catch(ignore){return false;}
  }).slice(0,32);
 }catch(ignore){return null;}
}
function report(options,entry,stage,outcome,error){
 if(!options||typeof options.report!=='function')return;
 var code=error&&/^[A-Z0-9_]{1,48}$/.test(error.code)?error.code:null;
 var row={device:entry&&/^\/dev\/sd[a-z]+[0-9]*$/.test(entry.device)?entry.device:null,
  filesystem:entry&&/^[a-z0-9]{1,16}$/.test(entry.type)?entry.type:null,
  writable:!!entry&&entry.flags.indexOf('rw')!==-1,stage:stage,outcome:outcome};
 if(error)row.code=code||'UNCLASSIFIED';
 try{options.report(row);}catch(ignore){}
}
async function ensureWritable(options){
 var a=adapters(options);if(a.remount===false)return;var remount=a.remount||defaultRemount,root=path.resolve(a.mediaRoot),list=entries(a.readMounts()),i;
 for(i=0;i<list.length;i++){var e=list[i],m=path.resolve(e.mount||'');if(!e.mount||e.flags.indexOf('rw')!==-1||!WRITABLE[e.type]||m.indexOf(root+'/')!==0)continue;try{a.deviceIdentity(e.device);}catch(error){report(options,e,'remount-verify','failed',error);continue;}try{await remount(m);report(options,e,'remount','requested');}catch(error){report(options,e,'remount','failed',error);}}
}
async function discover(options){
 var a=adapters(options),found=[],list;
 try{await ensureWritable(options);list=entries(a.readMounts());}
 catch(error){report(options,null,'mount-table','failed',error);throw error;}
 var root=path.resolve(a.mediaRoot),candidates=list.filter(function(e){return e.mount.indexOf(root+'/')===0;});
 if(!candidates.length)report(options,null,'mount-table','no-candidates');
 for(var i=0;i<candidates.length;i++){
  var e=candidates[i],stage='verify';
  try{
   var g=verify(e.mount,options);
   if(g.device!==e.device)throw Object.assign(Error('USB mount source changed during discovery'),{code:'MOUNT_CHANGED'});
   await g.check();stage='space';
   var s=await a.space(e.mount);
   // Discovery may race a remount or detach while df is running.
   stage='recheck';await g.check();
   found.push({mount:e.mount,volume:e.mount,name:path.basename(e.mount),device:e.device,filesystem:e.type,linkSpeedMbps:g.linkSpeedMbps,total:s.total,used:s.used,free:s.free});
   report(options,e,'discover','ready');
  }catch(error){report(options,e,stage,'failed',error);}
 }
 return found;
}
module.exports={discover:discover,verify:verify,space:space,entries:entries,usbBlockInventory:usbBlockInventory,ensureWritable:ensureWritable,linkSpeedMbps:linkSpeedMbps};
