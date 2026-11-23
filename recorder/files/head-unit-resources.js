'use strict';
var fs=require('fs'),path=require('path');
function memory(text){
 var out={},fields={MemTotal:'totalBytes',MemAvailable:'availableBytes',MemFree:'freeBytes',SwapTotal:'swapTotalBytes',SwapFree:'swapFreeBytes'};
 String(text).split('\n').forEach(function(line){
  var m=/^(\w+):\s+(\d+)\s+kB$/.exec(line);
  if(m&&fields[m[1]])out[fields[m[1]]]=Number(m[2])*1024;
 });
 return out;
}
function runningApps(options){
 var o=options||{},proc=o.proc||'/proc',registry=o.registry||'/var/opt/public/oap/oap_12201/data/apps';
 var deploy=o.deploy||'/var/opt/mgu-deploy/state.json',tracked=new Map(),running=new Map(),result={running:[],coverage:'mgu-deploy-apps'};
 try{
  var state=JSON.parse(fs.readFileSync(deploy,'utf8'));
  Object.keys(state.apps||{}).filter(function(id){return id!=='bimmervision'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);}).slice(0,64).forEach(function(id){
   try{
    var entry=JSON.parse(fs.readFileSync(path.join(registry,id+'.json'),'utf8'));
    if(Number.isInteger(entry.userId)&&entry.userId>=12203&&entry.userId<=65535)tracked.set(entry.userId,id);
   }catch(ignore){}
  });
  var pids=fs.readdirSync(proc).filter(function(p){return /^\d{1,10}$/.test(p);});
  if(pids.length>2048)result.truncated=true;
  pids.slice(0,2048).forEach(function(pid){
   try{
    var status=fs.readFileSync(path.join(proc,pid,'status'),'utf8'),uid=/^Uid:\s*(\d+)/m.exec(status);
    var id=uid&&tracked.get(Number(uid[1]));
    if(!id||/^State:\s*Z/m.test(status))return;
    var rss=/^VmRSS:\s*(\d+)\s+kB/m.exec(status),app=running.get(id)||{app:id,processes:0,rssBytesSum:0};
    app.processes++;if(rss)app.rssBytesSum+=Number(rss[1])*1024;running.set(id,app);
   }catch(ignore){}
  });
  result.running=Array.from(running.values()).sort(function(a,b){return a.app.localeCompare(b.app);});
 }catch(ignore){result.unavailable=true;}
 return result;
}
module.exports={memory:memory,runningApps:runningApps};

// Health samples arrive every five seconds. A second matching interval filters short spikes.
function Pressure(){this.previous=null;this.reason='';this.since=0;this.last=null;}
Pressure.prototype.update=function(system,now){
 var memory=system.memoryBytes||{},cpu=system.cpuTicks,reason='';
 if(memory.totalBytes>0 && Number.isFinite(memory.availableBytes) &&
    memory.availableBytes < Math.min(128*1024*1024,memory.totalBytes*0.05))
   reason='Head unit memory low · '+Math.round(memory.availableBytes/1048576)+' MiB available';
 var previous=this.previous;
 if(cpu && previous && !reason){
   var keys=Object.keys(cpu),total=0;
   keys.forEach(function(k){total+=cpu[k]-previous[k];});
   var idle=cpu.idle-previous.idle+cpu.ioWait-previous.ioWait;
   if(total>0 && idle>=0 && idle/total<0.05)reason='Head unit CPU busy · over 95% in use';
 }
 this.previous=cpu;
 var kind=reason.split(' · ')[0];
 if(kind!==this.reason || this.last===null || now-this.last>15000){this.reason=kind;this.since=now;}
 this.last=now;
 return now-this.since>=5000?reason:'';
};
module.exports.Pressure=Pressure;
