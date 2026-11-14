'use strict';
var MAX=8*1024*1024;
function parsePacket(b) {
 if(!Buffer.isBuffer(b)||b.length<12||b.length>65536||b[0]>>>6!==2)throw new Error('Malformed RTP header');
 var count=b[0]&15,off=12+count*4,end=b.length,csrc=[];
 if(off>end)throw new Error('Truncated RTP CSRC');for(var i=0;i<count;i++)csrc.push(b.readUInt32BE(12+i*4));
 var extension=null;if(b[0]&16){if(off+4>end)throw new Error('Truncated RTP extension');var size=b.readUInt16BE(off+2)*4;if(off+4+size>end)throw new Error('Truncated RTP extension data');extension={profile:b.readUInt16BE(off),data:b.slice(off+4,off+4+size)};off+=4+size;}
 var padding=0;if(b[0]&32){padding=b[end-1];if(!padding||padding>end-off)throw new Error('Invalid RTP padding');end-=padding;}
 if(off>=end)throw new Error('Empty RTP payload');
 return {sequence:b.readUInt16BE(2),timestamp:b.readUInt32BE(4),ssrc:b.readUInt32BE(8),marker:!!(b[1]&128),payloadType:b[1]&127,csrc:csrc,extension:extension,padding:padding,payload:b.slice(off,end),raw:b};
}
// This camera sends intra pictures as non-IDR NAL type 1 with slice_type I.
// Type 5 remains a sync point. A predicted slice still depends on an earlier picture.
function rbsp(nal){var out=[],i;for(i=1;i<nal.length;i++){if(i+2<nal.length&&nal[i]===0&&nal[i+1]===0&&nal[i+2]===3){out.push(0,0);i+=2;}else out.push(nal[i]);}return Buffer.from(out);}
function golomb(buf){var bit=0;function read(){if(bit>>3>=buf.length)throw Error('short');var v=(buf[bit>>3]>>(7-(bit&7)))&1;bit++;return v;}function ue(){var z=0;while(read()===0){z++;if(z>31)throw Error('short');}var v=1,n;for(n=0;n<z;n++)v=(v<<1)|read();return v-1;}return ue;}
function intraSlice(nal){var t=nal[0]&31;if(t===5)return true;if(t!==1)return false;try{var ue=golomb(rbsp(nal.slice(0,32)));ue();var slice=ue();return slice===2||slice===4||slice===7||slice===9;}catch(e){return false;}}
function syncNal(nal){return !!(nal&&nal.length&&intraSlice(nal));}
function eachNal(payload,fn){if(!payload||!payload.length)return;var t=payload[0]&31;if(t>=1&&t<=23){fn(payload);return;}if(t===28&&payload.length>=2){if(!(payload[1]&128))return;fn(Buffer.concat([Buffer.from([(payload[0]&224)|(payload[1]&31)]),payload.slice(2)]));return;}if(t===24){var off=1;while(off+2<=payload.length){var n=payload.readUInt16BE(off);off+=2;if(!n||off+n>payload.length)return;fn(payload.slice(off,off+n));off+=n;}}}
function syncPayload(payload){var found=false;eachNal(payload,function(n){if(syncNal(n))found=true;});return found;}
function opensPredicted(payload){var found=false;eachNal(payload,function(n){var t=n[0]&31;if(t>=1&&t<=5&&!syncNal(n))found=true;});return found;}
function AccessUnits(onUnit,onEvent,options){this.onUnit=onUnit;this.onEvent=onEvent||function(){};this.streams={};this.window=(options&&options.window)||64;this.maxStreams=8;this.metadataOnly=!!(options&&options.metadataOnly);}
AccessUnits.prototype.loss=function(s,reason,packets,atUs){s.au=null;s.fu=null;s.ready=false;s.sps=null;s.pps=null;this.onEvent({type:'discontinuity',reason:reason,packets:packets||0,ssrc:s.ssrc,atUs:atUs});};
AccessUnits.prototype.push=function(packet,atUs){
 var p;try{p=Buffer.isBuffer(packet)?parsePacket(packet):packet;if(!p||!Buffer.isBuffer(p.payload))throw Error('Malformed RTP packet');}catch(e){this.onEvent({type:'discontinuity',reason:'malformed-rtp',atUs:atUs});Object.keys(this.streams).forEach(function(k){var s=this.streams[k];s.au=null;s.fu=null;s.ready=false;s.sps=null;s.pps=null;},this);return;}
 var key=String(p.ssrc),s=this.streams[key];
 if(!s){if(Object.keys(this.streams).length>=this.maxStreams){var oldest=Object.keys(this.streams).sort(function(a,b){return this.streams[a].lastAt-this.streams[b].lastAt;}.bind(this))[0];this.loss(this.streams[oldest],'ssrc-retired',0,atUs);delete this.streams[oldest];}s=this.streams[key]={ssrc:p.ssrc,next:p.sequence,pending:{},count:0,au:null,fu:null,sps:null,pps:null,ready:false,lastAt:atUs};}
 var delta=(p.sequence-s.next+65536)%65536;s.lastAt=atUs;
 // RFC3550-style two-packet probation distinguishes large restarts from late packets.
 if(delta>3000&&delta<65436){if(s.candidate&&p.sequence===(s.candidate.p.sequence+1)%65536){var candidate=s.candidate;s.pending={};s.count=0;this.loss(s,'rtp-sequence-restart',0,atUs);s.next=candidate.p.sequence;s.pending[s.next]=candidate;s.count=1;s.candidate=null;}else{s.candidate={p:p,t:atUs};return;}}else{s.candidate=null;if(delta>=32768)return;}
 if(s.pending[p.sequence])return;
 s.pending[p.sequence]={p:p,t:atUs};s.count++;
 if(delta>this.window||s.count>this.window)this.drain(s,true);
 this.drain(s,false);
};
AccessUnits.prototype.drain=function(s,force){
 while(s.count){var item=s.pending[s.next];if(!item){if(!force)return;var nearest=65536;Object.keys(s.pending).forEach(function(k){nearest=Math.min(nearest,(Number(k)-s.next+65536)%65536);});this.loss(s,'rtp-sequence-gap',nearest,s.pending[(s.next+nearest)%65536].t);s.next=(s.next+nearest)%65536;continue;}
 delete s.pending[s.next];s.count--;s.next=(s.next+1)%65536;this.consume(s,item.p,item.t);}
};
AccessUnits.prototype.flush=function(){Object.keys(this.streams).forEach(function(k){this.drain(this.streams[k],true);var s=this.streams[k];if(s.au||s.fu)this.loss(s,'incomplete-access-unit',0,s.lastAt);},this);};
AccessUnits.prototype.consume=function(s,p,atUs){
 if(s.au&&s.au.timestamp!==p.timestamp)this.loss(s,'missing-access-unit-marker',0,atUs);
 if(!s.au)s.au={timestamp:p.timestamp,nals:[],bytes:0,atUs:atUs,idr:false};
 var self=this;
 function retain(n){var type=n[0]&31;return self.metadataOnly&&type!==7&&type!==8?Buffer.from(n.slice(0,32)):Buffer.from(n);}
 function add(n,originalLength){if(!n.length||(originalLength||n.length)>MAX||(n[0]&128)||(n[0]&31)===0||(n[0]&31)>=24)throw Error('invalid-nal');s.au.bytes+=originalLength||n.length;if(s.au.bytes>MAX)throw Error('access-unit-limit');if(s.au.nals.length>=8192)throw Error('access-unit-limit');s.au.nals.push(n);if((n[0]&31)===7)s.sps=Buffer.from(n);if((n[0]&31)===8)s.pps=Buffer.from(n);if(syncNal(n))s.au.idr=true;}
 try{
  var b=p.payload,type=b[0]&31;
  if(b[0]&128)throw Error('invalid-nal');
  if(type>=1&&type<=23){if(s.fu)throw Error('interrupted-fragment');add(retain(b),b.length);}
  else if(type===24){if(s.fu)throw Error('interrupted-fragment');var off=1;while(off<b.length){if(off+2>b.length)throw Error('malformed-stap');var n=b.readUInt16BE(off);off+=2;if(!n||off+n>b.length)throw Error('malformed-stap');add(retain(b.slice(off,off+n)),n);off+=n;}if(off===1)throw Error('empty-stap');}
  else if(type===28){if(b.length<3||(b[1]&32)||!(b[1]&31)||(b[1]&31)>=24)throw Error('malformed-fu');var start=!!(b[1]&128),end=!!(b[1]&64),nal=(b[0]&224)|(b[1]&31);if(start&&end)throw Error('malformed-fu');if(start){if(s.fu)throw Error('interrupted-fragment');s.fu={parts:[Buffer.from([nal]),Buffer.from(b.slice(2,self.metadataOnly&&(nal&31)!==7&&(nal&31)!==8?33:b.length))],bytes:b.length-1,nal:nal};}else{if(!s.fu||s.fu.nal!==nal)throw Error('orphan-fragment');s.fu.bytes+=b.length-2;if(s.fu.bytes>MAX||s.fu.parts.length>=8192)throw Error('nal-limit');var retained=self.metadataOnly?s.fu.parts.reduce(function(n,p){return n+p.length;},0):0,limit=self.metadataOnly&&(nal&31)!==7&&(nal&31)!==8?Math.max(0,32-retained):b.length-2;if(limit)s.fu.parts.push(Buffer.from(b.slice(2,2+limit)));}if(end){var f=s.fu;s.fu=null;add(Buffer.concat(f.parts),f.bytes);}}
  else throw Error('unsupported-h264-packet');
  if(p.marker){if(s.fu)throw Error('incomplete-fragment');var au=s.au;s.au=null;if(au.idr&&s.sps&&s.pps)s.ready=true;if(s.ready&&au.nals.some(function(n){return (n[0]&31)<=5;}))self.onUnit({ssrc:s.ssrc,rtpTimestamp:au.timestamp,atUs:au.atUs,nals:au.nals,idr:au.idr,sps:Buffer.from(s.sps),pps:Buffer.from(s.pps)});}
 }catch(e){this.loss(s,e.message,0,atUs);}
};
// CAMP framing is supplied by the enrolled receiver; no alternate ABI is invented.
function Camp(onPacket,onEvent){this.buffer=Buffer.alloc(65544);this.length=0;this.onPacket=onPacket;this.onEvent=onEvent||function(){};}
Camp.prototype.push=function(chunk,atUs){
 var pos=0;while(pos<chunk.length){var n=Math.min(chunk.length-pos,this.buffer.length-this.length);chunk.copy(this.buffer,this.length,pos,pos+n);this.length+=n;pos+=n;var off=0;while(this.length-off>=8){if(this.buffer.toString('ascii',off,off+4)!=='CAMP'){off++;continue;}var len=this.buffer.readUInt32LE(off+4);if(len<12||len>65536){off++;this.onEvent({type:'discontinuity',reason:'malformed-camp',atUs:atUs});continue;}if(this.length-off<8+len)break;this.onPacket(Buffer.from(this.buffer.slice(off+8,off+8+len)),atUs);off+=8+len;}if(off){this.buffer.copy(this.buffer,0,off,this.length);this.length-=off;}if(this.length===this.buffer.length){this.length=0;this.onEvent({type:'discontinuity',reason:'camp-overflow',atUs:atUs});}}
};
module.exports={parsePacket:parsePacket,AccessUnits:AccessUnits,Camp:Camp,syncNal:syncNal,syncPayload:syncPayload,opensPredicted:opensPredicted};
