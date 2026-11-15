'use strict';
// Compatibility shim ONLY for the decoder's private input. Never pass this
// output to Recorder or write it back to an original recording. No ECU calls.
var prefix=Buffer.from('060525b62c66633562426cfb625ef145d3415301','hex');
function adapt(nal){
 if(!Buffer.isBuffer(nal)||nal.length<24||!nal.slice(0,20).equals(prefix)||nal[20]!==50||nal[21]!==50||[7,9,10].indexOf(nal[22])<0)return nal;
 var copy=Buffer.from(nal);copy[20]=51;return copy;
}
function select(nals,view){
 if(['front','rear','left','right'].indexOf(view)<0)throw Error('Unknown preview camera');
 var wanted=view==='front'||view==='rear'?9:10,found=false;
 var result=nals.map(function(n){var a=adapt(n);if(a!==n&&n[22]===wanted){a[22]=1;found=true;}return a;});
 return found?result:null;
}
module.exports={adapt:adapt,select:select};
