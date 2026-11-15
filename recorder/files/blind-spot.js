'use strict';
var REQUEST='call 0xf8a6 128 1 1 f2402200000200000002d34700';
var labels={0:'OFF',1:'ON_STEADY',2:'ON_FLASH_LEVEL_1',3:'ON_FLASH_LEVEL_2',4:'ON_FLASH_LEVEL_3',13:'DISPLAY_ERROR',255:'INVALID'};
var definition={source:'BDC.AUSSENSPIEGEL_HC2',diagnosticAddress:64,dataIdentifier:54087,requestHex:'22d347',pollIntervalMs:500,responseTimeoutMs:2000,states:labels,interpretation:'Schema-mapped mirror indication, not a radar object list; missing data is not OFF.'};
function side(raw){return {raw:raw,state:labels[raw]||'UNKNOWN',valid:raw<=4,active:raw<=4?raw!==0:null};}
function BlindSpot(o){o=o||{};this.nowMs=o.nowMs||Date.now;this.nowUs=o.nowUs||require('./recorder').nowUs;this.onEvent=o.onEvent||function(){};this.send=null;this.pending=null;this.nextAt=0;}
BlindSpot.prototype.emit=function(event){event.schemaVersion=1;event.source=definition.source;event.diagnosticAddress=64;event.dataIdentifier=54087;try{this.onEvent(event,this.nowUs());}catch(ignore){}};
BlindSpot.prototype.unavailable=function(reason,responseHex,restart){this.pending=null;this.nextAt=this.nowMs()+5000;if(restart)this.send=null;this.emit({type:'blind-spot-status',state:'unavailable',reason:reason,responseHex:responseHex||null,requiresTransportRestart:restart===true});};
BlindSpot.prototype.start=function(send){this.send=send;this.pending=null;this.nextAt=0;};
BlindSpot.prototype.stop=function(){this.send=null;this.pending=null;};
BlindSpot.prototype.tick=function(){
 if(!this.send)return;var now=this.nowMs();
 if(this.pending!=null){if(now-this.pending>=2000)this.unavailable('Mirror status response timed out',null,true);return;}
 if(now<this.nextAt)return;
 this.pending=now;this.nextAt=now+500;
 try{this.send(REQUEST);}catch(e){this.unavailable(String(e.message||e));}
};
BlindSpot.prototype.receiveProxy=function(payload){
 if(!this.send||this.pending==null||this.nowMs()-this.pending>=2000||!Buffer.isBuffer(payload)||payload.length<19)return false;
 var n=payload.readUInt32BE(0);if(n<9||n>1024||payload.length!==4+n+6||payload.readUInt16BE(4+n)!==n)return false;
 var b=payload.slice(4,4+n);if(b[0]!==0xf0||b[1]!==0xf2||b[2]!==0x71||b[6]!==0x40||b.readUInt16BE(7)!==n-9)return false;
 if(payload.readUInt32BE(6+n)!==0){this.unavailable('Diagnostic proxy error '+payload.readUInt32BE(6+n));return true;}
 var u=b.slice(9),hex=u.toString('hex');
 if(u.length===3&&u[0]===0x7f&&u[1]===0x22){if(u[2]===0x78)return true;this.unavailable('UDS negative response '+hex,hex);if(u[2]===0x31)this.nextAt=this.nowMs()+30000;return true;}
 if(u.length!==5||u[0]!==0x62||u[1]!==0xd3||u[2]!==0x47)return false;
 var elapsed=this.nowMs()-this.pending;this.pending=null;
 this.emit({type:'blind-spot',state:'received',left:side(u[3]),right:side(u[4]),requestHex:'22d347',responseHex:hex,payloadEncoding:'base64',payload:u.toString('base64'),roundTripMs:elapsed});return true;
};
module.exports={BlindSpot:BlindSpot,definition:definition,request:REQUEST};
