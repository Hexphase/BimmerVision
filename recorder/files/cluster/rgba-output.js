// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hexphase
'use strict';
var convert=require('./decoded-frame').convertI420,Pacer=require('./pacer').Pacer;
// Map ownership outlives individual decoder sessions. A camera switch only
// hides/replaces RGBA pixels; relinquishing Map is an explicit release.
function Output(createClient,events,clock){this.createClient=createClient||function(){return new(require('./renderer-link').RendererLink)('bimmervision-cluster');};this.events=events||{};this.cr=null;this.image=null;this.shown=false;this.targetKnown=false;this.generation=null;this.opacityValue=0;this.width=0;this.height=0;this.onCommit=null;var self=this;this.pacer=new Pacer(function(frame){return self.commit(frame);},clock,function(e){if(self.events.error)self.events.error(e);});}
Output.prototype.begin=function(generation,onCommit){this.dropImage();this.generation=generation;this.onCommit=onCommit||null;this.pacer.begin(generation);this.opacity(0);if(this.cr)return;var self=this,cr=this.createClient();this.cr=cr;var black=Buffer.from([0,0,0,255]),refs=[];
 refs.push(cr.image({target:'map',klass:'content',z:0,x:0,y:0,w:1088,h:480,iw:1,ih:1,contend:true,prewarm:true,visible:true}));
 refs.push(cr.image({target:'map',klass:'overlay',z:100,x:0,y:0,w:224,h:480,iw:1,ih:1,visible:true}));
 refs.push(cr.image({target:'map',klass:'overlay',z:100,x:864,y:0,w:224,h:480,iw:1,ih:1,visible:true}));
 function live(){return self.cr===cr;}
 function error(e){if(live()&&self.events.error)self.events.error(e);}
 function blackPixels(){if(live())refs.forEach(function(ref){cr.pixels(ref,null,black);});}
 blackPixels();cr.on('ready',blackPixels);cr.on('error',error);cr.on('disconnected',function(){error(Error('Cluster renderer disconnected'));});cr.on('refused',function(op,ref,reason){error(Error('Cluster renderer refused '+op+': '+reason));});
 cr.on('target',function(name,state){if(!live()||name!=='map')return;var shown=state==='shown';if(self.targetKnown&&shown===self.shown)return;self.targetKnown=true;self.dropImage();self.shown=shown;if(shown&&self.generation!==null)self.pacer.begin(self.generation);else self.pacer.suspend();self.opacity(0);if(self.events.target)self.events.target(shown);});cr.connect();};
Output.prototype.dropImage=function(){if(this.cr&&this.image)this.cr.drop(this.image);this.image=null;this.width=this.height=0;};
Output.prototype.end=function(generation){if(this.generation!==generation)return;this.pacer.end(generation);this.onCommit=null;this.generation=null;this.opacity(0);this.dropImage();};
Output.prototype.paintFrame=function(generation,frame,view){if(!this.cr||generation!==this.generation||!this.shown)return false;return this.pacer.enqueue(generation,convert(frame,view));};
// This callback means pixels accepted by the real client, not presented by
// KOMBI. The worker must not start its fade or count output on enqueue alone.
Output.prototype.commit=function(image){if(!this.cr||image.generation!==this.generation||!this.shown)return false;
 if(this.image&&(this.width!==image.width||this.height!==image.height)){this.cr.drop(this.image);this.image=null;}
 if(!this.image){this.width=image.width;this.height=image.height;this.image=this.cr.image({target:'map',klass:'overlay',z:300,x:224,y:0,w:640,h:480,iw:image.width,ih:image.height,fps:15,visible:false,opacity:0});}
 if(this.cr.pixels(this.image,null,image.pixels)===false)return false;
 if(this.onCommit)this.onCommit(image);return true;};
Output.prototype.opacity=function(value){this.opacityValue=value;if(this.cr&&this.image)this.cr.set(this.image,{opacity:value,visible:value>0&&this.shown});};
Output.prototype.close=function(){this.pacer.suspend();this.onCommit=null;var cr=this.cr;this.cr=null;this.generation=null;this.image=null;this.shown=false;this.targetKnown=false;this.opacityValue=0;this.width=this.height=0;if(cr)cr.close();};
module.exports={Output:Output};
