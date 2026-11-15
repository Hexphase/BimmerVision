'use strict';
var select=require('./camera-pair').select,MAX=8388608,START=Buffer.from([0,0,0,1]);
// Writer owns one complete AU, potentially partway through the FIFO. Keep at
// most one newest complete selected AU behind it; never splice encoded bytes.
function Feeder(writer,view,selector){this.writer=writer;this.view=view;this.select=selector||select;this.latest=null;this.needsSync=true;this.closed=false;var self=this;this.drain=function(){if(self.closed||!self.latest)return;var next=self.latest;self.latest=null;self.writer.write(next);};writer.on('drain',this.drain);}
Feeder.prototype.discontinuity=function(){this.latest=null;this.needsSync=true;};
Feeder.prototype.push=function(unit){
 if(this.closed)return 'closed';
 // The other composite alternates with ours. Its arrival must not invalidate
 // a selected frame merely because the selected FIFO is still draining.
 var chosen=this.select(unit.nals,this.view);if(!chosen)return 'ignored';
 var replaced=!!this.latest;if(replaced)this.discontinuity();
 if(this.needsSync&&!unit.idr)return 'waiting-sync';
 var parts=[START,unit.sps,START,unit.pps],bytes=8+unit.sps.length+unit.pps.length;
 chosen.forEach(function(n){if((n[0]&31)!==7&&(n[0]&31)!==8){bytes+=4+n.length;if(bytes>MAX)throw Error('Preview access-unit limit');parts.push(START,n);}});
 if(bytes>MAX)throw Error('Preview access-unit limit');var data=Buffer.concat(parts,bytes);this.needsSync=false;
 if(this.writer.pending){this.latest=data;return replaced?'replaced':'queued';}
 this.writer.write(data);return 'written';
};
Feeder.prototype.close=function(){if(this.closed)return;this.closed=true;this.latest=null;this.writer.removeListener('drain',this.drain);};
module.exports={Feeder:Feeder};
