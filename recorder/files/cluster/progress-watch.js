'use strict';
function Watch(){this.shown=false;this.started=0;this.lastFrame=0;}
Watch.prototype.reset=function(now){this.started=now;this.lastFrame=0;};
Watch.prototype.target=function(shown,now){if(shown&&!this.shown)this.reset(now);this.shown=shown;};
Watch.prototype.frame=function(now){this.lastFrame=now;};
Watch.prototype.error=function(now){if(!this.shown||now-this.started<=5000)return null;return !this.lastFrame||now-this.lastFrame>3000?'Preview frames stopped progressing while the Map target was shown':null;};
module.exports={Watch:Watch};
