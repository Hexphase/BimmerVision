// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hexphase
'use strict';
var LIMIT=4*1024*1024,HEADER=32;
function shape(width,height){if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width%2||height%2||width>1920||height>1080)throw Error('Invalid decoder frame size');return width*height*3/2;}
function FrameReader(emit){if(typeof emit!=='function')throw Error('Decoder frame callback required');this.emit=emit;this.buffer=Buffer.alloc(0);}
Object.defineProperty(FrameReader.prototype,'pendingBytes',{get:function(){return this.buffer.length;}});
FrameReader.prototype.push=function(chunk){
 if(!Buffer.isBuffer(chunk)||chunk.length+this.buffer.length>LIMIT)throw Error('Decoder frame buffer limit');
 this.buffer=this.buffer.length?Buffer.concat([this.buffer,chunk]):chunk;
 while(this.buffer.length>=HEADER){
  var b=this.buffer;
  if(b.toString('ascii',0,4)!=='BVCF'||b.readUInt16LE(4)!==1||b.readUInt16LE(6)!==1||b.readUInt32LE(28)!==0)throw Error('Invalid decoder frame header');
  var width=b.readUInt16LE(16),height=b.readUInt16LE(18),length=shape(width,height),hi=b.readUInt32LE(12);
  if(b.readUInt16LE(20)!==width||b.readUInt16LE(22)!==width/2||b.readUInt32LE(24)!==length)throw Error('Invalid decoder frame payload');
  if(hi>2097151)throw Error('Decoder frame sequence limit');
  if(b.length<HEADER+length)return;
  var frame={width:width,height:height,sequence:hi*4294967296+b.readUInt32LE(8),data:Buffer.from(b.slice(HEADER,HEADER+length))};
  this.buffer=b.slice(HEADER+length);this.emit(frame);
 }
};
FrameReader.prototype.finish=function(){if(this.buffer.length)throw Error('Truncated decoder frame');};
function convertI420(frame,view){
 if(['front','rear','left','right'].indexOf(view)<0)throw Error('Unknown preview camera');
 if(!frame||!Buffer.isBuffer(frame.data)||frame.data.length!==shape(frame.width,frame.height)||frame.width%4)throw Error('Invalid decoder frame payload or size');
 var w=frame.width,h=frame.height,half=w/2,x0=view==='rear'||view==='right'?half:0,yBytes=w*h,cBytes=yBytes/4,data=frame.data,pixels=Buffer.alloc(half*h*4);
 function byte(v){return v<0?0:v>255?255:Math.round(v);}
 for(var y=0;y<h;y++)for(var x=0;x<half;x++){
  var sx=x0+x,ci=(y>>1)*(w/2)+(sx>>1),Y=data[y*w+sx],U=data[yBytes+ci]-128,V=data[yBytes+cBytes+ci]-128,i=(y*half+x)*4;
  pixels[i]=byte(Y+1.402*V);pixels[i+1]=byte(Y-0.344136*U-0.714136*V);pixels[i+2]=byte(Y+1.772*U);pixels[i+3]=255;
 }
 return {width:half,height:h,pixels:pixels,id:frame.sequence};
}
module.exports={FrameReader:FrameReader,convertI420:convertI420};
