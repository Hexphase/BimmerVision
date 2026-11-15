'use strict';
function RecordingHealth(){this.lastWarningMs=-Infinity;this.reset();}
RecordingHealth.prototype.reset=function(){this.retryAt=-Infinity;this.enabled=false;this.enabledSince=null;this.hadHealthy=false;this.unhealthySince=null;this.healthySince=null;this.warned=false;this.lastWrite=null;this.progressAt=-Infinity;};
RecordingHealth.prototype.update=function(status,intent,now){
 status=status||{};intent=intent||{};
 if(intent.continuous===false){this.reset();return null;}
 if(intent.continuous===true&&!this.enabled){this.enabled=true;this.enabledSince=now;}
 if(!this.enabled)return null;
 if(status.setupPending&&!this.hadHealthy){this.enabledSince=now;return null;}
 var metrics=status.metrics||{},heartbeat=status.heartbeatMonotonicUs,write=metrics.lastVideoWriteMonotonicUs;
 var heartbeatAge=now*1000-heartbeat,writeAge=now*1000-write;
 var healthy=status.state==='Recording'&&!!status.activeId&&Number.isFinite(heartbeat)&&heartbeatAge>=0&&heartbeatAge<=5000000&&Number.isFinite(write)&&write>0&&writeAge>=0&&writeAge<3000000;
 if(healthy){
  this.hadHealthy=true;this.unhealthySince=null;
  if(this.healthySince===null)this.healthySince=now;
  if(write!==this.lastWrite){this.lastWrite=write;this.progressAt=now;}
  if(this.warned&&now>=this.retryAt&&now-this.healthySince>=3000&&now-this.progressAt<=1000){this.warned=false;return {kind:'restored',message:'BimmerVision\nRecording restored.\nVideo is being saved again.'};}
  return null;
 }
 this.healthySince=null;
 if(this.unhealthySince===null)this.unhealthySince=now;
 var since=this.hadHealthy?this.unhealthySince:this.enabledSince,grace=this.hadHealthy?5000:20000;
 if(this.warned||now<this.retryAt||now-since<grace||now-this.lastWarningMs<120000)return null;
 this.warned=true;this.lastWarningMs=now;
 var detail=status.state==='Storage full'?'Recording stopped: USB full.\nFree space when parked.':status.state==='Drive unavailable'||status.state==='Waiting for USB'?'Recording interrupted.\nCheck the USB drive when parked.':'Recording interrupted.\nTrying to restore camera video.';
 if(!Number.isFinite(heartbeat)||heartbeatAge>5000000)detail='Recorder not responding.\nCheck BimmerVision when parked.';
 return {kind:'interrupted',message:'BimmerVision\n'+detail};
};
RecordingHealth.prototype.deliveryFailed=function(kind,now){this.retryAt=now+10000;if(kind==='interrupted'){this.warned=false;this.lastWarningMs=-Infinity;}else if(kind==='restored')this.warned=true;};
module.exports={RecordingHealth:RecordingHealth};
