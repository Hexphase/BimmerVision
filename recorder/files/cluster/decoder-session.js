// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hexphase
'use strict';
var fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
var Writer=require('./fifo-writer').Writer,Feeder=require('./frame-feeder').Feeder;
var FrameReader=require('./decoded-frame').FrameReader,select=require('./camera-pair').select,endChild=require('./process').endChild;
function DecoderSession(options){this.o=options;this.dir=null;this.child=null;this.writer=null;this.feeder=null;this.closed=false;this.started=false;this.failed=false;this.stopping=null;}
DecoderSession.prototype.fail=function(error){if(this.closed||this.failed)return;this.failed=true;if(this.o.onError)this.o.onError(error);};
DecoderSession.prototype.start=async function(){
 if(this.closed||this.started)return this;this.started=true;var self=this,o=this.o;
 try{
  this.dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-decoder-'));var fifo=path.join(this.dir,'input.h264');cp.execFileSync('/usr/bin/mkfifo',[fifo],{timeout:5000});
  this.writer=new Writer(fifo);this.writer.on('error',function(e){self.fail(e);});this.feeder=new Feeder(this.writer,o.view,select);
  o.renderer.begin(o.generation,function(frame){if(!self.closed&&o.onFrame)o.onFrame(frame);});
  var reader=new FrameReader(function(frame){if(!self.closed)o.renderer.paintFrame(o.generation,frame,o.view);});
  this.child=cp.spawn(o.binary||path.join(__dirname,'bvcamera-decode'),['--input',fifo,'--width','592','--height','220'],{detached:true,stdio:['ignore','pipe','pipe']});
  this.child.on('error',function(e){self.fail(e);});this.child.on('exit',function(code,signal){self.fail(Error('BimmerVision decoder exited '+code+' '+(signal||'')));});
  this.child.stdout.on('data',function(b){if(self.closed)return;try{reader.push(b);}catch(e){self.fail(e);}});
  this.child.stdout.on('error',function(e){self.fail(e);});
  this.child.stderr.on('data',function(b){if(!self.closed&&o.onDiagnostic)o.onDiagnostic(b.toString('utf8').slice(0,1024));});
  return this;
 }catch(e){await this.stop();throw e;}
};
DecoderSession.prototype.push=function(unit){if(!this.closed&&this.feeder)return this.feeder.push(unit);return 'closed';};
DecoderSession.prototype.discontinuity=function(){if(this.feeder)this.feeder.discontinuity();};
DecoderSession.prototype.stop=function(){
 if(this.stopping)return this.stopping;this.closed=true;var self=this;
 this.stopping=(async function(){var error=null;function attempt(fn){try{fn();}catch(e){if(!error)error=e;}}
  if(self.feeder)attempt(function(){self.feeder.close();});
  if(self.writer)attempt(function(){self.writer.end();});
  try{await endChild(self.child);}catch(e){error=error||e;}
  if(self.started)attempt(function(){self.o.renderer.end(self.o.generation);});
  if(self.dir)attempt(function(){fs.readdirSync(self.dir).forEach(function(name){fs.unlinkSync(path.join(self.dir,name));});fs.rmdirSync(self.dir);});
  if(error)throw error;
 })();return this.stopping;
};
module.exports={DecoderSession:DecoderSession};
