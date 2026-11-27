'use strict';
var TARGET='323207',READ='call 0x3003 1 17 1',CHANGE='call 0x3003 1 20 1 ';
var definition={source:'ICAM.XView3D',serviceId:12291,instanceId:1,majorVersion:1,currentStateGetter:17,stateEvent:32777,changePerspectiveMethod:20,requestedStateHex:TARGET,pollIntervalMs:1000,requestIntervalMs:5000,profile:'iDrive7 Surround View, live-verified native DR_STANDBY/MODE_MOSAIK/perspective7',entitlementIndependence:'Not verified on an unentitled car; no entitlement or provisioning is modified.'};
// During head-unit wake, a transient OFF report can precede BMW taking the display.
var STARTUP_IDLE_MS=10000, MAX_OBSERVATION_GAP_MS=2500;
function CameraControl(o){o=o||{};this.nowMs=o.nowMs||Date.now;this.nowUs=o.nowUs||require('./recorder').nowUs;this.onEvent=o.onEvent||function(){};this.send=null;this.owned=false;this.current=null;this.observedAt=null;this.observedAtUs=null;this.observations=[];this.restore=null;this.nextPoll=0;this.nextRequest=0;this.lastHealth=0;}
CameraControl.prototype.emit=function(state,reason,extra){if(state==='unavailable')this.stateUnavailable=true;try{this.onEvent(Object.assign({type:'camera-control',schemaVersion:1,source:definition.source,state:state,reason:reason,currentStateHex:this.current,requestOwned:this.owned},extra||{}),this.nowUs());}catch(ignore){}};
CameraControl.prototype.start=function(send){this.send=send;this.startupIdleSince=null;this.startupSettled=false;this.owned=false;this.current=null;this.observedAt=null;this.observedAtUs=null;this.observations=[];this.restore=null;this.nextPoll=0;this.nextRequest=0;this.lastHealth=0;};
CameraControl.prototype.request=function(hex){try{this.send(CHANGE+hex);return true;}catch(e){this.emit('unavailable',String(e.message||e));return false;}};
CameraControl.prototype.observe=function(hex){
 if(!this.send)return;
 if(typeof hex!=='string'||!/^[0-9a-f]{6}$/i.test(hex)){this.current=null;this.observedAt=null;this.observedAtUs=null;this.owned=false;this.remember(null);this.emit('unavailable','Malformed camera state');return;}
 hex=hex.toLowerCase();var mode=parseInt(hex.slice(2,4),16);if([0,1,2,3,4,5,6,7,8,9,10,11,12,13,20,30,40,50,60].indexOf(mode)<0){this.current=null;this.observedAt=null;this.observedAtUs=null;this.owned=false;this.restore=null;this.remember(null);this.emit('unavailable','Unfilled or unknown camera mode');return;}
 var previous=this.current,previousAt=this.observedAt;
 var now=this.nowMs(),changed=this.current!==hex||this.stateUnavailable,application=parseInt(hex.slice(0,2),16);this.current=hex;this.stateUnavailable=false;this.observedAt=now;this.observedAtUs=this.nowUs();this.remember(hex,this.observedAtUs);
 if(changed)this.emit('observed','Camera state notification/getter');
 if(!this.startupSettled){
  if(application!==0 || previous!==hex || previousAt==null || now<previousAt || now-previousAt>MAX_OBSERVATION_GAP_MS){
   this.startupIdleSince=application===0?now:null;
  }
 }
 if(application===0){
  if(!this.startupSettled && (this.startupIdleSince==null || now-this.startupIdleSince<STARTUP_IDLE_MS))return;
  if(now<this.nextRequest)return;
  this.restore=hex;this.nextRequest=now+5000;
  if(this.request(TARGET)){this.startupSettled=true;this.owned=true;this.emit('requested','Native recorder state requested',{requestedStateHex:TARGET});}
 }else if(application===50||application===51||application===52){
  if(hex!==TARGET){this.owned=false;this.restore=null;}
  if(this.owned&&hex===TARGET&&now>=this.nextRequest){this.nextRequest=now+5000;this.request(TARGET);}
 }else{
  this.owned=false;this.restore=null;
  if(changed)this.emit(application===255?'unavailable':'yielding','Another/unknown camera application owns the view');
 }
};
CameraControl.prototype.remember=function(hex,atUs){this.observations.push({hex:hex,atUs:atUs==null?this.nowUs():atUs});if(this.observations.length>128)this.observations.shift();};
CameraControl.prototype.snapshot=function(atUs){var sample=null;for(var i=this.observations.length-1;i>=0;i--){if(this.observations[i].atUs<=atUs){sample=this.observations[i];break;}}var valid=this.send&&sample&&sample.hex&&atUs-sample.atUs<=2500000;return {type:'camera-control',schemaVersion:1,source:definition.source,state:'snapshot',reason:valid?'Camera state at segment start':'No fresh camera state at segment start',currentStateHex:valid?sample.hex:null,observedAtUs:valid?sample.atUs:null};};
CameraControl.prototype.tick=function(){if(!this.send)return;var now=this.nowMs();if(now>=this.nextPoll){this.nextPoll=now+1000;try{this.send(READ);}catch(e){this.emit('unavailable',String(e.message||e));}}if((this.observedAt==null||now-this.observedAt>2500)&&now-this.lastHealth>=2500){this.lastHealth=now;this.emit('unavailable','No fresh camera state; no activation inferred');}};
CameraControl.prototype.stop=function(release){var sent=false;if(release!==false&&this.send&&this.owned&&this.restore&&this.observedAt!=null&&this.nowMs()-this.observedAt<=2000&&(this.current===TARGET||this.current===this.restore)){sent=this.request(this.restore);if(sent)this.emit('released','Restored the OFF state observed before our request',{restoredStateHex:this.restore});}this.send=null;this.owned=false;return sent;};
module.exports={CameraControl:CameraControl,definition:definition};
