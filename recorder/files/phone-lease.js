'use strict';
// Poll RAM controls independently of storage scans and HTTP startup. The lease
// still expires after three seconds without a fresh visible Connect Phone beat.
function Lease(o){this.read=o.read;this.now=o.nowMs||function(){var t=process.hrtime();return t[0]*1000+t[1]/1e6;};this.onRevoke=o.onRevoke||function(){};this.value=null;this.busy=null;this.timer=null;this.closed=false;this.error=null;}
Lease.prototype.get=function(){var v=this.value,now=this.now();return !this.closed&&v&&v.visible===true&&typeof v.visit==='string'&&v.visit&&Number.isFinite(v.atMs)&&v.atMs<=now&&now-v.atMs<3000?{visit:v.visit,atMs:v.atMs}:null;};
Lease.prototype.replace=function(v){var old=this.value;this.value=v;if(old&&(!v||old.visit!==v.visit)){try{var p=this.onRevoke();if(p&&p.catch)p.catch(function(){});}catch(ignore){}}};
Lease.prototype.poll=function(){if(this.closed)return Promise.resolve();if(this.busy)return this.busy;var self=this;this.busy=Promise.resolve().then(function(){return self.read();}).then(function(v){if(self.closed)return;self.error=null;var now=self.now(),good=v&&v.visible===true&&typeof v.visit==='string'&&v.visit&&v.visit.length<=128&&Number.isFinite(v.atMs)&&v.atMs<=now&&now-v.atMs<3000;self.replace(good?{visit:v.visit,visible:true,atMs:v.atMs}:null);},function(e){if(self.closed)return;self.error=String(e.message||e);self.replace(null);}).then(function(){self.busy=null;});return this.busy;};
Lease.prototype.start=function(){if(this.closed)return Promise.resolve();var self=this;if(!this.timer){this.timer=setInterval(function(){self.poll();},250);if(this.timer.unref)this.timer.unref();}return this.poll();};
Lease.prototype.stop=function(){this.closed=true;clearInterval(this.timer);this.timer=null;this.value=null;return this.busy||Promise.resolve();};
module.exports={Lease:Lease};
