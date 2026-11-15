'use strict';
// Full-range BT.601, applied only to the small, downscaled preview half.
// Atlas: Y above U and V, with U/V side-by-side in each chroma row.
function convert(packet,layer,view){
 var w=layer.vw,h=layer.vh;if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||w%2||h%2||w>1920||h>720)throw Error('Unsupported preview atlas size');
 if(packet.length!==19+w*h*3/2||packet[4]!==70||packet.readUInt16LE(17)!==0)throw Error('Expected a complete preview atlas');
 if(['front','rear','left','right'].indexOf(view)<0)throw Error('Unknown preview view');
 var half=w/2,x0=view==='rear'||view==='right'?half:0,b=packet.slice(19),rgba=Buffer.alloc(half*h*4);
 function byte(v){return v<0?0:v>255?255:Math.round(v);}
 for(var y=0;y<h;y++)for(var x=0;x<half;x++){
  var sx=x0+x,Y=b[y*w+sx],uv=w*h+(y>>1)*w+(sx>>1),U=b[uv]-128,V=b[uv+half]-128,i=(y*half+x)*4;
  rgba[i]=byte(Y+1.402*V);rgba[i+1]=byte(Y-0.344136*U-0.714136*V);rgba[i+2]=byte(Y+1.772*U);rgba[i+3]=255;
 }
 return {width:half,height:h,pixels:rgba};
}
module.exports={convert:convert};
