'use strict';
// Read-only BDC horn-button status. A polled observation is not an exact switch edge.
var REQUEST='call 0xf8a6 128 1 1 f2402200000200000002d29700';
var definition={source:'BDC.HUPE_TASTER',diagnosticAddress:64,dataIdentifier:53911,requestHex:'22d297',pollIntervalMs:100,responseTimeoutMs:2000,states:{0:'RELEASED',1:'PRESSED'},interpretation:'Read-only horn-button samples; transitions may occur between polls. Missing, rejected and stale readings are unknown.'};
function Horn(o){o=o||{};this.nowMs=o.nowMs||Date.now;this.nowUs=o.nowUs||require('./recorder').nowUs;this.onEvent=o.onEvent||function(){};this.send=null;this.pending=null;this.nextAt=0;}
Horn.prototype.emit=function(e){e.schemaVersion=1;e.source=definition.source;e.diagnosticAddress=64;e.dataIdentifier=53911;try{this.onEvent(e,this.nowUs());}catch(ignore){}};
Horn.prototype.unavailable=function(reason,hex,restart){this.pending=null;this.nextAt=this.nowMs()+5000;if(restart)this.send=null;this.emit({type:'horn-status',state:'unavailable',reason:reason,responseHex:hex||null,requiresTransportRestart:restart===true});};
Horn.prototype.start=function(send){this.send=send;this.pending=null;this.nextAt=0;};
Horn.prototype.stop=function(){var active=!!this.send;this.send=null;this.pending=null;if(active)this.emit({type:'horn-status',state:'unavailable',reason:'Horn sampling stopped'});};
Horn.prototype.tick=function(){if(!this.send)return;var now=this.nowMs();if(this.pending!=null){if(now-this.pending>=2000)this.unavailable('Horn status response timed out',null,true);return;}if(now<this.nextAt)return;this.pending=now;this.nextAt=now+100;try{this.send(REQUEST);}catch(e){this.unavailable(String(e.message||e),null,true);}};
Horn.prototype.receiveProxy=function(payload){
 if(!this.send||this.pending==null||this.nowMs()-this.pending>=2000||!Buffer.isBuffer(payload)||payload.length<19)return false;
 var n=payload.readUInt32BE(0);if(n<9||n>1024||payload.length!==4+n+6||payload.readUInt16BE(4+n)!==n)return false;
 var b=payload.slice(4,4+n);if(b[0]!==0xf0||b[1]!==0xf2||b[2]!==0x71||b[6]!==0x40||b.readUInt16BE(7)!==n-9)return false;
 if(payload.readUInt32BE(6+n)!==0){this.unavailable('Diagnostic proxy error '+payload.readUInt32BE(6+n));return true;}
 var u=b.slice(9),hex=u.toString('hex');
 if(u.length===3&&u[0]===0x7f&&u[1]===0x22){if(u[2]===0x78)return true;this.unavailable('UDS negative response '+hex,hex);if(u[2]===0x31)this.nextAt=this.nowMs()+30000;return true;}
 if(u.length!==4||u[0]!==0x62||u[1]!==0xd2||u[2]!==0x97)return false;
 var elapsed=this.nowMs()-this.pending;this.pending=null;
 if(u[3]!==0&&u[3]!==1){this.unavailable('Unknown horn-button state',hex);return true;}
 this.emit({type:'horn',state:'observed',valid:true,pressed:u[3]===1,raw:u[3],requestHex:'22d297',responseHex:hex,roundTripMs:elapsed,pollIntervalMs:100});return true;
};
module.exports={Horn:Horn,definition:definition,request:REQUEST};
