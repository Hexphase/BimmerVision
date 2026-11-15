// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Hexphase
'use strict';
// BMW's recording-mode user-data SEI identifies which two-camera composite
// follows. Selection is read-only: the original H264 NAL bytes reach decoding.
var marker=Buffer.from('060525b62c66633562426cfb625ef145d3415301','hex');
function select(nals,view){
 if(['front','rear','left','right'].indexOf(view)<0)throw Error('Unknown preview camera');
 if(!Array.isArray(nals)||nals.length>4096)throw Error('Camera access-unit limit');
 var pair=view==='front'||view==='rear'?9:10;
 for(var i=0;i<nals.length;i++){
  var n=nals[i];if(Buffer.isBuffer(n)&&n.length>=24&&n.slice(0,marker.length).equals(marker)&&n[20]===50&&n[21]===50&&n[22]===pair)return nals;
 }
 return null;
}
module.exports={select:select};
