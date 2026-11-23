'use strict';
// Main-loop adapter: attach only after guard.check() has verified a USB mount.
// observe(status) does no filesystem work and never consumes raw telemetry,
// IDs, routes, network/pairing data or credentials. State bursts coalesce to at
// most one transition/second; health is at most once/5s. Durability work is
// scheduled off the control call stack; it never waits inside observe().
var path=require('path'),os=require('os'),DiagnosticLog=require('./diagnostic-log').DiagnosticLog,version=require('./version.json').version;
var fs=require('fs'),headUnit=require('./head-unit-resources');
var METRICS=['packets','writtenVideoPackets','queueLimit','videoPackets','videoBytes','queuedBytes','applicationDroppedPackets','nativeReceiverDrops','sequenceGaps','observedSequenceGaps','writeErrors','lastVideoWriteMonotonicUs','writeBytes','writeCalls','writeUs','maxWriteUs','syncCalls','syncUs','maxSyncUs'];
function text(v){return typeof v==='string'?v.slice(0,512):null;}
function numbers(input,keys){var out={};input=input||{};keys.forEach(function(k){var v=input[k];if(typeof v==='number'&&Number.isFinite(v))out[k]=v;});return out;}
function transition(status){return {state:text(status.state),error:text(status.error),storageWarning:text(status.storageWarning),recordingEnabled:status.recordingEnabled===true,recordingActive:!!status.activeId,deleting:status.deleting===true};}
// Sample only for a due health record. Counters are cumulative, with explicit
// units so successive samples can derive CPU usage without guessing core count.
function resources(){
 var result={process:{},system:{}},unavailable=[];
 try{result.process.cpuUsageUs=numbers(process.cpuUsage(),['user','system']);}catch(ignore){unavailable.push('processCpuUsage');}
 try{result.process.memoryBytes=numbers(process.memoryUsage(),['rss','heapTotal','heapUsed','external','arrayBuffers']);}catch(ignore){unavailable.push('processMemory');}
 try{var load=os.loadavg();if(!Array.isArray(load)||load.length<3||load.slice(0,3).some(function(v){return typeof v!=='number'||!Number.isFinite(v);}))throw Error('Unavailable load average');result.system.loadAverage=load.slice(0,3);}catch(ignore){unavailable.push('systemLoadAverage');}
 try{
  var cpus=os.cpus(),totals={user:0,sys:0,idle:0,irq:0,nice:0},keys=Object.keys(totals);
  if(!Array.isArray(cpus)||!cpus.length)throw Error('Unavailable CPU counters');
  cpus.forEach(function(cpu){keys.forEach(function(key){var value=cpu&&cpu.times&&cpu.times[key];if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Unavailable CPU counter');totals[key]+=value;});});
  result.system.cpuCount=cpus.length;result.system.cpuTimesMs=totals;
 }catch(ignore){unavailable.push('systemCpuTimes');}
 if(process.platform==='linux'){
  try{result.system.memoryBytes=headUnit.memory(fs.readFileSync('/proc/meminfo','utf8'));}catch(ignore){unavailable.push('systemMemory');}
  try{
   var cpu=fs.readFileSync('/proc/stat','utf8').split('\n')[0].trim().split(/\s+/).slice(1,9).map(Number);
   if(cpu.length===8&&cpu.every(Number.isFinite))result.system.cpuTicks=numbers({user:cpu[0],nice:cpu[1],system:cpu[2],idle:cpu[3],ioWait:cpu[4],irq:cpu[5],softIrq:cpu[6],steal:cpu[7]},['user','nice','system','idle','ioWait','irq','softIrq','steal']);
  }catch(ignore){unavailable.push('systemCpuTicks');}
 }
 if(unavailable.length)result.unavailable=unavailable;return result;
}
function DiagnosticSession(options){var o=options||{};this.now=o.nowMs||Date.now;this.enabled=o.enabled===true;this.targetMount=null;this.targetGuard=null;this.logger=null;this.mount=null;this.detaching=null;this.signature=null;this.lastTransition=-Infinity;this.lastHealth=-Infinity;this.lastEvent=-Infinity;this.eventWindow=0;this.closed=false;this.flushTimer=null;this.backgroundFlush=null;this.lastFlush=-Infinity;this.lastApps=-Infinity;this.pressure=new headUnit.Pressure();this.resourceWarning="";this.lastResourceSample=-Infinity;}
DiagnosticSession.prototype.startLogger=function(){
 if(!this.enabled||this.closed||this.detaching||this.logger||!this.targetMount)return;
 var self=this,guard=this.targetGuard;this.mount=this.targetMount;
 this.logger=new DiagnosticLog({directory:path.join(this.mount,'BimmerVision-Logs'),check:async function(){if(!self.enabled)throw Error('Recording disabled');await guard.check();if(!self.enabled)throw Error('Recording disabled');}});
 this.signature=null;this.lastTransition=this.lastHealth=this.lastEvent=-Infinity;this.eventWindow=0;this.lastFlush=-Infinity;this.lastApps=-Infinity;
 this.logger.log('session-start',{schemaVersion:1,version:text(version)});
};
DiagnosticSession.prototype.attach=function(mount,guard){
 try{if(this.closed||this.detaching||typeof mount!=='string'||!mount||!guard||typeof guard.check!=='function')return false;mount=path.resolve(mount);if(this.targetMount&&this.targetMount!==mount)return false;this.targetMount=mount;this.targetGuard=guard;this.startLogger();return true;}catch(ignore){return false;}
};
DiagnosticSession.prototype.setEnabled=function(enabled){
 if(this.enabled && !enabled){this.pressure=new headUnit.Pressure();this.resourceWarning='';}
 this.enabled=enabled===true;
 if(this.enabled){this.startLogger();return this.detaching||Promise.resolve();}
 if(this.flushTimer){clearImmediate(this.flushTimer);this.flushTimer=null;}
 if(!this.logger||this.logger.disabled&&this.logger.closed)return this.detaching||Promise.resolve();
 var self=this,logger=this.logger,previous=this.detaching;
 var pending=Promise.all([logger.stop(),this.backgroundFlush,previous]).catch(function(){}).then(function(){if(self.logger===logger){self.logger=null;self.mount=null;}if(self.detaching===pending)self.detaching=null;self.startLogger();});this.detaching=pending;return pending;
};
DiagnosticSession.prototype.observe=function(status){
 try{
  if(this.closed||!status)return false;if(status.recordingEnabled!==true){this.setEnabled(false);return false;}if(!this.enabled)this.setEnabled(true);
  var now=this.now();
  if(now-this.lastResourceSample>=5000){
   this.lastResourceSample=now;this.sample=resources();this.resourceWarning=this.pressure.update(this.sample.system,now);
  }
  if(!this.logger||this.detaching||this.closed)return false;
  var state=transition(status),signature=JSON.stringify(state),health=false;
  if(signature!==this.signature&&now-this.lastTransition>=1000){if(this.logger.log('state',state)){this.signature=signature;this.lastTransition=now;}}
  if(now-this.lastHealth>=5000){
   this.lastHealth=now; // Bound sampling attempts even when the log queue is full.
   var sample=this.sample;
   if(this.logger.log('health',{state:state,resourceWarning:this.resourceWarning,resources:sample,metrics:numbers(status.metrics,METRICS),recordingCount:typeof status.recordingCount==='number'?status.recordingCount:null})){health=true;}
  }
  if(health){
   if(process.platform==='linux'&&now-this.lastApps>=30000){
    this.lastApps=now;
    this.logger.log('running-apps',headUnit.runningApps());
   }
   this.scheduleFlush(now);
  }
  return true;
 }catch(ignore){return false;}
};
// Coalesce durability requests; even the USB guard's synchronous internals stay
// outside observe()/recorder-control callers. A busy disk never blocks control.
DiagnosticSession.prototype.scheduleFlush=function(now){
 if(!this.enabled||this.flushTimer||this.backgroundFlush||!this.logger||this.detaching)return;
 var self=this,logger=this.logger;this.lastFlush=now;
 this.flushTimer=setImmediate(function(){
  self.flushTimer=null;if(!self.enabled||self.logger!==logger||self.detaching)return;
  var pending=logger.flush().catch(function(){});self.backgroundFlush=pending;
  pending.then(function(){if(self.backgroundFlush===pending)self.backgroundFlush=null;});
 });
};
// Extra control/fault events: narrow detail allowlist and maximum8 events/sec.
DiagnosticSession.prototype.event=function(name,data){
 try{
  if(!this.enabled||!this.logger||this.detaching||this.closed||typeof name!=='string'||!/^[a-z][a-z0-9.-]{0,63}$/.test(name))return false;
  var now=this.now();if(now-this.lastEvent>=1000){this.lastEvent=now;this.eventWindow=0;}if(this.eventWindow>=8)return false;
  data=data||{};var out=numbers(data,['durationMs','code','exitCode','signalNumber','queuedBytes','packets','applicationDroppedPackets','sequenceGaps']);
  ['reason','error','code','signal','state','version'].forEach(function(k){if(typeof data[k]==='string')out[k]=text(data[k]);});
  ['recordingEnabled'].forEach(function(k){if(typeof data[k]==='boolean')out[k]=data[k];});
  this.eventWindow++;return this.logger.log(name,out);
 }catch(ignore){return false;}
};
DiagnosticSession.prototype.support=function(name,data){
 if(!this.enabled||!this.logger||this.detaching||this.closed)return false;
 return this.logger.log(name,data);
};
DiagnosticSession.prototype.info=function(){var info=this.logger?this.logger.info():{bytes:0,writing:false,pendingDurability:false,dirty:false,syncing:false,queuedBytes:0,dropped:0,error:null};return Object.assign({enabled:this.enabled,attached:!!this.logger&&!this.logger.disabled,closing:!!this.detaching},info);};
DiagnosticSession.prototype.flush=async function(){try{if(!this.enabled){if(this.detaching)await this.detaching;return;}if(this.flushTimer){clearImmediate(this.flushTimer);this.flushTimer=null;}if(this.detaching)await this.detaching;else{if(this.backgroundFlush)await this.backgroundFlush;if(this.logger)await this.logger.flush();}}catch(ignore){}};
DiagnosticSession.prototype.detach=function(reason){
 this.targetMount=null;this.targetGuard=null;if(this.detaching)return this.detaching;if(this.flushTimer){clearImmediate(this.flushTimer);this.flushTimer=null;}if(!this.logger)return Promise.resolve();var self=this,logger=this.logger;
 logger.log('session-stop',{reason:text(reason)});
 this.detaching=Promise.all([logger.close(),this.backgroundFlush]).catch(function(){}).then(function(){if(self.logger===logger){self.logger=null;self.mount=null;}self.detaching=null;});return this.detaching;
};
DiagnosticSession.prototype.close=async function(){this.closed=true;await this.detach('shutdown');};
module.exports={DiagnosticSession:DiagnosticSession};
