'use strict';
// Nonblocking FIFO with at most one access unit pending. Opening/closing never
// depends on the decoder acquiring the display or opening its read endpoint.
var fs=require('fs'),EventEmitter=require('events').EventEmitter,util=require('util');
function Writer(file){EventEmitter.call(this);this.fd=fs.openSync(file,fs.constants.O_RDWR|fs.constants.O_NONBLOCK);this.pending=null;this.offset=0;this.timer=null;this.closed=false;}
util.inherits(Writer,EventEmitter);
Writer.prototype.write=function(data){if(this.closed||this.pending)return false;if(data.length>8388608)throw Error('Preview access-unit limit');this.pending=data;this.offset=0;this.pump();return !this.pending;};
Writer.prototype.pump=function(){
 if(this.closed||!this.pending)return;
 try{while(this.offset<this.pending.length){var n=fs.writeSync(this.fd,this.pending,this.offset,Math.min(16384,this.pending.length-this.offset));if(!n)throw Error('Zero-byte preview pipe write');this.offset+=n;}}
 catch(e){if(e.code==='EAGAIN'||e.code==='EWOULDBLOCK'){var self=this;this.timer=setTimeout(function(){self.timer=null;self.pump();},5);return;}this.end();this.emit('error',e);return;}
 this.pending=null;this.emit('drain');
};
Writer.prototype.end=function(){if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.timer=null;this.pending=null;fs.closeSync(this.fd);};
module.exports={Writer:Writer};
