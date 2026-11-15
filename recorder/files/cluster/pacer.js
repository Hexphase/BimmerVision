'use strict';
var PERIOD=1000/15,BUFFER=100,MAX_AGE=150;
function defaultClock(){return {now:function(){var t=process.hrtime();return t[0]*1000+t[1]/1000000;},setTimeout:setTimeout,clearTimeout:clearTimeout};}
// Bounded playout: two complete RGBA frames, one absolute clock,
// no repeated frames and no catch-up loop after the event loop falls behind.
function Pacer(emit,clock,onError){this.emit=emit;this.clock=clock||defaultClock();this.onError=onError;this.queue=[];this.generation=null;this.epoch=0;this.timer=null;this.deadline=null;this.active=false;this.closed=false;this.lastId=null;this.stats={accepted:0,committed:0,overflow:0,stale:0,duplicate:0,missedDeadlines:0};}
Pacer.prototype.clear=function(){this.clock.clearTimeout(this.timer);this.timer=null;this.queue=[];this.deadline=null;this.epoch++;};
Pacer.prototype.begin=function(generation){if(this.closed)return;this.clear();this.generation=generation;this.lastId=null;this.active=true;};
Pacer.prototype.enqueue=function(generation,frame){if(this.closed||!this.active||generation!==this.generation)return false;if(frame.id!==undefined&&this.lastId!==null&&frame.id<=this.lastId){this.stats.duplicate++;return false;}this.lastId=frame.id;frame.generation=generation;frame.receivedAt=this.clock.now();this.queue.push(frame);this.stats.accepted++;if(this.queue.length>2){this.queue.shift();this.stats.overflow++;}if(this.timer===null){this.deadline=this.clock.now()+BUFFER;this.schedule();}return true;};
Pacer.prototype.schedule=function(){var self=this,epoch=this.epoch;this.timer=this.clock.setTimeout(function(){self.tick(epoch);},Math.max(0,Math.ceil(this.deadline-this.clock.now())));};
Pacer.prototype.tick=function(epoch){if(this.closed||!this.active||epoch!==this.epoch)return;this.timer=null;var now=this.clock.now();while(this.queue.length&&now-this.queue[0].receivedAt>MAX_AGE){this.queue.shift();this.stats.stale++;}var next=this.queue.shift();if(next){try{if(this.emit(next)!==false)this.stats.committed++;}catch(e){this.suspend();if(this.onError)this.onError(e);else throw e;return;}}if(this.closed||!this.active||epoch!==this.epoch)return;this.deadline+=PERIOD;now=this.clock.now();if(this.deadline<=now){var missed=Math.floor((now-this.deadline)/PERIOD)+1;this.stats.missedDeadlines+=missed;this.deadline+=missed*PERIOD;}this.schedule();};
Pacer.prototype.suspend=function(){this.clear();this.active=false;};
Pacer.prototype.end=function(generation){if(this.generation!==generation)return;this.suspend();this.generation=null;};
Pacer.prototype.close=function(){this.clear();this.closed=true;this.active=false;this.generation=null;};
module.exports={Pacer:Pacer};
