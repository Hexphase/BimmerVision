"use strict";
var fs=require("fs"),path=require("path"),io=require("./io"),setup=require("./setup");
var SELF="bimmervision-recorder";
function list(p){try{return fs.readdirSync(p);}catch(e){if(e.code==="ENOENT")return [];throw e;}}
function read(p){try{return fs.readFileSync(p,"utf8");}catch(e){if(e.code==="ENOENT")return "";throw e;}}
function json(p){var s=read(p);return s?JSON.parse(s):null;}
async function ensure(options){
 var o=options||{},configs=(o.mainappFiles||["/usr/lib/oap-mainapp/config/base.json"]).map(json).filter(Boolean),ranges=[],taken=new Set();
 function add(n){n=Number(n);if(Number.isInteger(n)&&n>0)taken.add(n);}
 configs.forEach(function(c){[c.usableUidsAndGids].concat(Object.keys(c.usableUidsAndGidsRse||{}).map(function(k){return c.usableUidsAndGidsRse[k];})).forEach(function(r){if(r&&Number.isInteger(r.min)&&Number.isInteger(r.max)&&r.min>0&&r.max>=r.min)ranges.push(r);});(c.mainAppUids||[]).forEach(add);});
 if(!ranges.length)throw Error("OEM identity ranges unavailable for backup networking");
 var etc=o.etcDir||"/etc",oap=o.oapRoot||"/var/opt/public/oap",proc=o.procRoot||"/proc",uplink=o.uplinkRoot||"/var/opt/mgu-uplink",tools=o.toolRoot||"/var/opt";
 read(path.join(etc,"passwd")).split("\n").forEach(function(l){var a=l.split(":");add(a[2]);add(a[3]);});read(path.join(etc,"group")).split("\n").forEach(function(l){add(l.split(":")[2]);});
 list(oap).forEach(function(n){var m=/^oap_(\d+)$/.exec(n);if(m)add(m[1]);});
 var manager=path.join(oap,"oap_12201");list(path.join(manager,"data/apps")).forEach(function(n){var d=json(path.join(manager,"data/apps",n));if(d)add(d.userId);});
 read(path.join(manager,"security/uids.txt")).split("\n").forEach(function(l){add(l.split("=")[0]);});
 list(path.join(uplink,"uids.d")).filter(function(n){return n!==SELF;}).forEach(function(n){read(path.join(uplink,"uids.d",n)).split("\n").forEach(function(l){l.split("#")[0].split(/[\s,]+/).forEach(add);});});
 // Reserve persisted updater identities even when its optional workers are idle.
 var updater=json(path.join(tools,"mgu-updater/state/uids.json"));if(updater)Object.keys(updater).forEach(function(k){add(updater[k]);});
 function reserved(n){return taken.has(n)||ranges.some(function(r){return n>=r.min&&n<=r.max;});}
 var base=o.base||"/var/opt/bimmervision-recorder",dir=path.join(base,"data"),file=path.join(dir,"backup-network-uid"),st;
 setup.privateDir(dir);
 try{st=fs.lstatSync(file);}catch(e){if(e.code!=="ENOENT")throw e;}
 if(st){
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077)||st.size>16)throw Error("Unsafe backup network identity");
  var saved=read(file).trim(),uid=Number(saved);
  if(!/^\d+$/.test(saved)||!Number.isInteger(uid)||uid<=0||uid>60000)throw Error("Unsafe backup network identity");
  if(reserved(uid))throw Error("Backup network identity collision; networking disabled");
 }
 function ownWorker(pid,status,identity){
  try{
   var exe=fs.realpathSync(path.join(proc,pid,"exe")),mode=fs.statSync(exe),cg=read(path.join(proc,pid,"cgroup"));
   if(mode.uid!==0||(mode.mode&0o022)||!/(?:^|\n)[^\n]*:\/[^\n]*\/bimmervision-recorder\.service(?:\n|$)/.test(cg))return false;
   var u=/^Uid:[ \t]+([^\n]+)/m.exec(status),g=/^Gid:[ \t]+([^\n]+)/m.exec(status),groups=/^Groups:([^\n]*)/m.exec(status);
   if(!u||!g||!groups||groups[1].trim()||u[1].trim().split(/\s+/).concat(g[1].trim().split(/\s+/)).some(function(n){return Number(n)!==identity;}))return false;
   if(exe==="/usr/bin/curl")return /^NoNewPrivs:[ \t]+1$/m.test(status)&&/^CapEff:[ \t]+0*2000$/m.test(status)&&/^CapAmb:[ \t]+0*2000$/m.test(status);
   return exe.indexOf(path.resolve(base,"versions")+path.sep)===0&&path.basename(exe)==="backup-wifi-curl";
  }catch(e){return false;}
 }
 list(proc).filter(function(n){return /^\d+$/.test(n);}).forEach(function(pid){try{var status=read(path.join(proc,pid,"status")),live=[];status.split("\n").forEach(function(l){var m=/^(?:[UG]id|Groups):[ \t]*(.*)$/.exec(l);if(m)m[1].trim().split(/\s+/).forEach(function(n){if(Number(n)>0)live.push(Number(n));});});if(st&&live.indexOf(uid)>=0){if(!ownWorker(pid,status,uid))throw Error("Backup network identity collision with a live process; networking disabled");return;}live.forEach(add);}catch(e){if(e.code!=="ESRCH"&&e.code!=="EACCES")throw e;}});
 if(st)return uid;
 var first=Math.max.apply(null,ranges.map(function(r){return r.max;}))+1;
 for(var pick=first;pick<=60000;pick++)if(!reserved(pick))break;
 if(pick>60000)throw Error("No free backup network identity");
 var temp=file+".new-"+process.pid,fd=fs.openSync(temp,"wx",0o600);
 try{fs.writeSync(fd,String(pick)+"\n");fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);await io.syncDir(dir);return pick;
}
module.exports={ensure:ensure};
