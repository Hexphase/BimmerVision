'use strict';
var https=require('https'),cache=new Map(),active=false,lastRequest=0;
function parse(raw){var m=/^(\d+(?:\.\d+)?)\s*(mph|km\/h)?$/.exec(String(raw||'').trim());if(!m)return null;var n=Number(m[1]);return n>0&&n<=200?{limit:n,unit:m[2]==='mph'?'mph':'km/h'}:null;}
function distance(geometry,lat,lon){var best=Infinity,c=Math.cos(lat*Math.PI/180);for(var i=1;i<(geometry||[]).length;i++){var a=geometry[i-1],b=geometry[i],x=(a.lon-lon)*111320*c,y=(a.lat-lat)*111320,dx=(b.lon-a.lon)*111320*c,dy=(b.lat-a.lat)*111320,z=dx*dx+dy*dy,t=z?Math.max(0,Math.min(1,-(x*dx+y*dy)/z)):0;best=Math.min(best,Math.sqrt((x+t*dx)*(x+t*dx)+(y+t*dy)*(y+t*dy)));}return best;}
function fromWays(ways,lat,lon){var near=(ways||[]).filter(function(w){return w.type==='way'&&w.tags&&w.tags.highway&&distance(w.geometry,lat,lon)<=12;});if(near.length!==1)return null;var w=near[0],tags=w.tags;if(Object.keys(tags).some(function(k){return /^maxspeed:/.test(k)&&k!=='maxspeed:type';}))return null;var r=parse(tags.maxspeed);if(!r)return null;r.source='OpenStreetMap maxspeed';r.attribution='© OpenStreetMap contributors';r.sourceUrl='https://www.openstreetmap.org/way/'+w.id;r.road=tags.name||null;r.isEstimated=false;var closest=0,best=Infinity;for(var j=0;j<(w.geometry||[]).length;j++){var g=w.geometry[j],d=Math.pow(g.lat-lat,2)+Math.pow((g.lon-lon)*Math.cos(lat*Math.PI/180),2);if(d<best){best=d;closest=j;}}r.geometry=(w.geometry||[]).slice(Math.max(0,closest-32),closest+33);return r;}
async function lookup(lat,lon){
 lat=Number(lat);lon=Number(lon);if(!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||(lat===0&&lon===0))return null;
 var key=lat.toFixed(5)+','+lon.toFixed(5),now=Date.now(),old=cache.get(key);if(old&&now<old.until)return old.value;
 if(active||now-lastRequest<1100)return null;active=true;lastRequest=now;
 try{var value=await new Promise(function(resolve){var finished=false,timer,req;function done(v){if(finished)return;finished=true;clearTimeout(timer);resolve(v);}
 var q='[out:json][timeout:4][maxsize:1048576];way["highway"](around:25,'+lat.toFixed(6)+','+lon.toFixed(6)+');out tags geom;';
 req=https.get('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{headers:{'User-Agent':'BimmerVision/0.2 personal-recording-viewer'},timeout:5000},function(res){var chunks=[],n=0;if(res.statusCode!==200){res.resume();done(null);return;}res.on('data',function(b){n+=b.length;if(n>1048576){req.destroy();done(null);}else chunks.push(b);});res.on('error',function(){done(null);});res.on('end',function(){try{var doc=JSON.parse(Buffer.concat(chunks).toString('utf8'));done(doc.remark?null:fromWays(doc.elements,lat,lon));}catch(e){done(null);}});});
 timer=setTimeout(function(){req.destroy();done(null);},5500);req.on('error',function(){done(null);});req.on('timeout',function(){req.destroy();done(null);});
 });cache.delete(key);cache.set(key,{value:value,until:now+(value?86400000:60000)});while(cache.size>1000)cache.delete(cache.keys().next().value);return value;
 }finally{active=false;}
}
module.exports={lookup:lookup,fromWays:fromWays,parseMaxspeed:parse,coordKey:function(lat,lon){return Number(lat).toFixed(5)+','+Number(lon).toFixed(5);}};
