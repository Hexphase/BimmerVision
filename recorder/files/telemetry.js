'use strict';
var path=require('path'),io=require('./io');
var NAMES=['speed','brake','accelerator','blinker','latitude','longitude','steeringAngleDeg','horn'];
async function profileFile(source,root){
 var name=source.name.replace(/\./g,'_')+'.json',original=path.join(source.dir,name);
 try{await io.lstat(original);await io.safePath(original,'file');return original;}catch(e){if(e.code!=='ENOENT')throw e;}
 var apps=await io.readdir(root);
 for(var i=0;i<apps.length;i++){
  if(!/^oap_[0-9]+$/.test(apps[i]))continue;
  var candidate=path.join(root,apps[i],'someipInterfaces',name);
  try{var st=await io.safePath(candidate,'file');if(st.size>2097152)continue;var cfg=JSON.parse(await io.readFile(candidate,'utf8'));if(cfg.serviceId===source.serviceId&&cfg.fields&&cfg.fields[source.field]&&cfg.fields[source.field].schema)return candidate;}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 throw Error('Validated OEM profile unavailable: '+source.name);
}
function Telemetry(options){var o=options||{};this.nowUs=o.nowUs||require('./recorder').nowUs;this.onEvent=o.onEvent||function(){};this.fields={};this.proxies={};this.attempts={};this.unclassified={};this.closed=false;this.connecting=false;this.profileRoot=o.profileRoot||'/var/opt/public/oap';}
Telemetry.prototype.snapshot=function(atUs){var out={},self=this;NAMES.forEach(function(k){var f=self.fields[k];if(!f)return;out[k]=Object.assign({},f,{ageUs:Math.max(0,atUs-f.atUs),sourceValid:f.valid,latched:k==='blinker',valid:f.valid&&atUs>=f.atUs&&(k==='blinker'||atUs-f.atUs<=2000000)});});return out;};
Telemetry.prototype.take=function(source,reading,atUs){
 if(this.closed||!Number.isSafeInteger(atUs)||atUs<0)return;var sourceName=source.sourceName||'BMW SOME/IP: '+source.name,kind=source.kind,self=this,values={};
 if(kind==='displayClock'){
  if(reading)this.dashboardOffsetMinutes=Math.round((reading.wallMs-Date.now())/60000);
  this.displayClock=reading?{type:'display-clock',source:'KombiIF.statusShowTimeDate',wallMs:reading.wallMs,sampleUs:atUs}:null;
  if(this.displayClock)this.onEvent(this.displayClock,atUs);
  return;
 }
 if(reading){if(kind==='speed'||(kind==='pace'&&typeof reading.speed==='number'&&isFinite(reading.speed)))values.speed={value:reading.speed,unit:reading.speedUnit};if(kind==='horn')values.horn={value:reading.horn};if(kind==='brake')values.brake={value:reading.braking};if(kind==='gas')values.accelerator={value:reading.accelerator};if(kind==='indicator')values.blinker={value:reading.indicator};if(kind==='position'){values.latitude={value:reading.latitude,unit:'deg'};values.longitude={value:reading.longitude,unit:'deg'};}if(kind==='steering')values.steeringAngleDeg={value:reading.degrees,unit:'deg',valid:reading.valid===true};}
 if(!reading){Object.keys(this.fields).forEach(function(k){if(self.fields[k].source===sourceName)self.fields[k].valid=false;});if(this.unclassified[kind]==null||atUs-this.unclassified[kind]>2000000){this.unclassified[kind]=atUs;this.onEvent({type:'telemetry-unclassified',source:sourceName,kind:kind,reason:'OEM value did not match validated profile'},atUs);}}
 Object.keys(values).forEach(function(k){var v=values[k],good=v.value!==undefined&&v.value!==null&&(typeof v.value!=='number'||isFinite(v.value));self.fields[k]={value:good?v.value:null,atUs:atUs,valid:good&&v.valid!==false,source:sourceName};if(v.unit)self.fields[k].unit=v.unit;});
 this.onEvent({type:'telemetry',fields:this.snapshot(atUs)},atUs);
};
function timeout(promise,ms,label){return new Promise(function(resolve,reject){var timer=setTimeout(function(){var e=Error(label+' timed out');e.ambiguousSubscription=/ subscribe$/.test(label);reject(e);},ms);Promise.resolve(promise).then(function(v){clearTimeout(timer);resolve(v);},function(e){clearTimeout(timer);reject(e);});});}
Telemetry.prototype.subscribe=async function(someip,source,validator){
 var file=await profileFile(source,this.profileRoot);await io.safePath(file,'file');var st=await io.stat(file);if(st.size>2097152)throw Error('OEM profile too large');var cfg=JSON.parse(await io.readFile(file,'utf8'));
 if(cfg.serviceId!==source.serviceId||!cfg.fields||!cfg.fields[source.field]||!cfg.fields[source.field].schema)throw Error('OEM profile service/field mismatch');
 cfg.methods={};var field=cfg.fields[source.field],self=this,proxy=await timeout(someip.buildProxy(cfg,source.instance),4000,source.kind+' build');
 await timeout(proxy.init(),4000,source.kind+' init');
 function receive(value){if(!self.closed)self.take(source,validator(source.kind,field.schema,value),self.nowUs());}
 await timeout(proxy.subscribe({name:source.field,onReceive:receive}),4000,source.kind+' subscribe');
 // Once subscribed the source stays reserved, including if its optional getter fails.
 this.proxies[source.kind]=proxy;
 if(field.getter){try{receive(await timeout(proxy.getValue(source.field,2000),3000,source.kind+' get'));}catch(e){this.onEvent({type:'telemetry-unclassified',source:source.name,reason:String(e.message||e)},this.nowUs());}}
 return proxy;
};
// Read the cluster clock even on units that only publish changes on request.
Telemetry.prototype.refreshClock=async function(){
 if(this.closed||this.clockBusy)return;
 this.clockBusy=true;
 try{
   var own=require('./oem-signals'),source=own.SOURCES.find(s=>s.kind==='displayClock');
   if(!this.clockProxy){
     var file=await profileFile(source,this.profileRoot),cfg=JSON.parse(await io.readFile(file,'utf8'));
     if(cfg.serviceId!==source.serviceId||!cfg.fields[source.field])return;
     cfg.fields={[source.field]:cfg.fields[source.field]};cfg.methods={};cfg.events={};
     this.clockProxy=await require('/usr/lib/someip.node').buildProxy(cfg,source.instance);
     await this.clockProxy.init();
   }
   var value=await this.clockProxy.getValue(source.field,2000);
   var reading=own.readSignal(source.kind,{},value);
   if(reading)this.take(source,reading,this.nowUs());
 }catch(e){}finally{this.clockBusy=false}
};
Telemetry.prototype.connect=async function(originalRoot){
 if(this.closed||this.connecting)return;this.connecting=true;var legacy,someip;
 try{try{legacy=require(path.join(originalRoot,'record-clip.js'));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;legacy=require('./oem-signals');}try{someip=require('someip');}catch(e){try{someip=require('/usr/lib/someip.node');}catch(nativeError){someip=require(path.join(originalRoot,'node_modules','someip'));}}
  // Reuse the backed-up source profiles and schema validator, never infer OEM enum values.
  var own=require('./oem-signals'),sources=legacy.SOURCES.slice();
  // New optional signals remain available when an older local profile bundle is retained.
  own.SOURCES.forEach(function(s){if((s.kind==='horn'||s.kind==='displayClock')&&!sources.some(function(old){return old.kind===s.kind;}))sources.push(s);});
  for(var i=0;i<sources.length;i++){var source=sources[i];if(this.closed)break;if(source.kind==="displayClock")continue;if(Object.prototype.hasOwnProperty.call(this.proxies,source.kind)||(this.attempts[source.kind]||0)>=3)continue;
   // Reserve before building: a timed-out remote subscribe may still finish. Never
   // retry it in this process and accumulate hidden duplicate subscriptions.
   this.proxies[source.kind]=null;this.attempts[source.kind]=(this.attempts[source.kind]||0)+1;
   try{await this.subscribe(someip,source,(source.kind==='horn'||source.kind==='displayClock')?own.readSignal:legacy.readSignal);}catch(e){if(!e.ambiguousSubscription)delete this.proxies[source.kind];this.onEvent({type:'telemetry-unclassified',source:source.name,reason:String(e.message||e)},this.nowUs());}
  }
 }catch(e){this.onEvent({type:'telemetry-unavailable',reason:String(e.message||e)},this.nowUs());}finally{this.connecting=false;}
};
Telemetry.prototype.stop=function(){this.closed=true;if(this.clockProxy)this.clockProxy.shutdown().catch(()=>{});};
module.exports={Telemetry:Telemetry};
