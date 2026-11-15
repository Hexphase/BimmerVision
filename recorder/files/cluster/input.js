'use strict';
var R=require('../rtp');
// Parameters may precede a late preview subscriber by hours. Cache only bounded,
// validated NALs; sequence state still begins at the first packet actually read.
function Input(onUnit,onLoss){this.cache={};this.onUnit=onUnit;this.onLoss=onLoss||function(){};this.resync();}
Input.prototype.parameters=function(streams){var self=this;if(!Array.isArray(streams)||streams.length>8)throw Error('Cluster parameter stream limit');streams.forEach(function(s){if(!s||!Number.isInteger(s.ssrc)||s.ssrc<0||s.ssrc>4294967295)throw Error('Invalid cluster parameter SSRC');function nal(v,type){if(typeof v!=='string'||v.length>87384||!/^[A-Za-z0-9+/]*={0,2}$/.test(v))throw Error('Invalid cluster parameter');var b=Buffer.from(v,'base64');if(b.length<1||b.length>65536||(b[0]&128)||(b[0]&31)!==type)throw Error('Invalid cluster parameter');return b;}var params={sps:nal(s.sps,7),pps:nal(s.pps,8)};if(!self.cache[s.ssrc]&&Object.keys(self.cache).length>=8)delete self.cache[Object.keys(self.cache)[0]];self.cache[s.ssrc]=params;});};
Input.prototype.resync=function(){var self=this;this.parser=new R.AccessUnits(function(u){if(u.sps.length<=65536&&u.pps.length<=65536){if(!self.cache[u.ssrc]&&Object.keys(self.cache).length>=8)delete self.cache[Object.keys(self.cache)[0]];self.cache[u.ssrc]={sps:Buffer.from(u.sps),pps:Buffer.from(u.pps)};}self.onUnit(u);},this.onLoss);var consume=this.parser.consume;this.parser.consume=function(s,p,t){var params=self.cache[s.ssrc];if(params){if(!s.sps)s.sps=Buffer.from(params.sps);if(!s.pps)s.pps=Buffer.from(params.pps);}consume.call(this,s,p,t);};if(!this.camp)this.camp=new R.Camp(function(b,t){self.packet(b,t);},this.onLoss);};
// Only decoder-session startup calls this, outside an active push callback.
Input.prototype.resetTransport=function(){this.camp.length=0;this.resync();};
Input.prototype.packet=function(b,t){this.parser.push(b,t);};
Input.prototype.push=function(b,t){this.camp.push(b,t);};
module.exports={Input:Input};
