'use strict';
// A single reconciliation owns start/stop. Intent replaces intent; it never
// appends a restart task. Every asynchronous frame is tied to its generation.
function Controller(adapter,clock){this.adapter=adapter;this.clock=clock||{now:Date.now,setTimeout:setTimeout,clearTimeout:clearTimeout};this.intent=null;this.generation=0;this.session=null;this.timer=null;this.fadeTimer=null;this.busy=null;this.closed=false;this.opacity=0;this.ready=false;this.due=0;}
Controller.prototype.fade=function(to,ms){var self=this,c=this.clock,from=this.opacity,start=c.now();c.clearTimeout(this.fadeTimer);this.fadeTimer=null;function step(){var t=Math.min(1,(c.now()-start)/ms);self.opacity=from+(to-from)*t;self.adapter.opacity(self.opacity);if(t<1)self.fadeTimer=c.setTimeout(step,20);else self.fadeTimer=null;}step();};
Controller.prototype.view=function(view){if(this.closed||['front','left','right',null].indexOf(view)<0||view===this.intent)return;this.intent=view;this.generation++;this.ready=false;this.fade(0,140);this.due=this.clock.now()+(view===null?140:150);this.schedule();};
Controller.prototype.schedule=function(){var self=this;this.clock.clearTimeout(this.timer);this.timer=null;if(this.closed||this.busy)return;this.timer=this.clock.setTimeout(function(){self.timer=null;self.run();},Math.max(0,this.due-this.clock.now()));};
Controller.prototype.run=function(){var self=this,g=this.generation;this.busy=(async function(){
 if(self.session){var old=self.session;self.session=null;await self.adapter.stop(old);}
 self.opacity=0;self.adapter.opacity(0);
 if(self.closed||g!==self.generation)return;
 if(self.intent===null){self.adapter.release();self.adapter.status('hidden');return;}
 self.adapter.status('starting');var session=await self.adapter.start(self.intent,g,function(){self.frame(g);});
 if(self.closed||g!==self.generation){await self.adapter.stop(session);return;}
 self.session=session;self.ready=false;self.adapter.status('waiting');
 })().catch(function(e){if(self.adapter.error)self.adapter.error(e);}).then(function(){self.busy=null;if(!self.closed&&g!==self.generation)self.schedule();});return this.busy;};
Controller.prototype.suspend=function(){this.clock.clearTimeout(this.fadeTimer);this.fadeTimer=null;this.ready=false;this.opacity=0;this.adapter.opacity(0);};
Controller.prototype.frame=function(g){if(this.closed||g!==this.generation||!this.session)return false;if(!this.ready){this.ready=true;this.fade(1,180);this.adapter.status('showing');}return true;};
Controller.prototype.close=async function(){if(this.closed)return this.busy;this.closed=true;this.generation++;this.clock.clearTimeout(this.timer);this.clock.clearTimeout(this.fadeTimer);this.timer=this.fadeTimer=null;if(this.busy)await this.busy;if(this.session){var old=this.session;this.session=null;await this.adapter.stop(old);}this.opacity=0;this.adapter.opacity(0);this.adapter.release();};
module.exports={Controller:Controller};
