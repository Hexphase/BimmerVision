"use strict";
var fs=require("fs"),path=require("path"),nowUs=require("./recorder").nowUs;
var SOURCES={
 condition:{name:"de_bmw_infrastructure_VehicleCondition",serviceId:5425,field:"VehicleCondition",member:"controlBasePartialNetworks",enums:{KOM_WOHNEN:5,KOM_FAHREN:10,KOM_PARKEN_BN_IO:2,KOM_STANDFUNKTIONEN_KUNDE_NICHT_IM_FZG:3}},
 engine:{name:"de_bmw_powertrain_Powertrain",serviceId:38192,field:"StatusCombustionEngine",member:"statusCombustionEngineDrive",enums:{MOTOR_STEHT:0,MOTOR_STARTET:1,MOTOR_LAEUFT:2}}
};
function VehicleState(options){var o=options||{};this.nowUs=o.nowUs||nowUs;this.profileRoot=o.profileRoot||"/var/opt/public/oap";this.someip=o.someip;this.samples={};this.lastOffAtUs=null;this.proxies={};this.subscriptions={};this.attempts={};this.closed=false;this.timer=null;this.connecting=null;}
VehicleState.prototype.receive=function(kind,value){
 if(this.closed)return;var sample={value:value||{},atUs:this.nowUs()};this.samples[kind]=sample;
 // Use the latest positive event, rather than the slower policy polling time,
 // while retaining the requirement for a previously corroborated off state.
 if(kind==="condition"){
  var mode=sample.value.controlBasePartialNetworks,positive=["KOM_WOHNEN","KOM_PARKEN_BN_IO","KOM_STANDFUNKTIONEN_KUNDE_NICHT_IM_FZG"].indexOf(mode)>=0;
  if(sample.value.statusConditionVehicle==="FAHREN"||!positive&&mode!=="KEINE_KOMMUNIKATION")this.lastOffAtUs=null;
  else if(positive&&this.lastOffAtUs!==null)this.lastOffAtUs=sample.atUs;
 }
 if(kind==="engine"&&(sample.value.statusCombustionEngineDrive!=="MOTOR_STEHT"||sample.value.statusMotorDrive!=="KEIN_E_MINUS_MASCHINE_VERFUEGBAR"))this.lastOffAtUs=null;
};
VehicleState.prototype.snapshot=function(speed){
 var now=this.nowUs(),c=this.samples.condition,e=this.samples.engine;
 function fresh(v){return v&&Number.isSafeInteger(v.atUs)&&now>=v.atUs&&now-v.atUs<=2000000;}
 var v=c&&c.value||{},engine=e&&e.value||{},mode=v.controlBasePartialNetworks;
 // This is the published network operating mode, not the separately qualified
 // statusConditionVehicle member (which this car reports unavailable when off).
 // Require independent engine-stop AND fresh zero-speed corroboration.
 var offMode=["KOM_WOHNEN","KOM_PARKEN_BN_IO","KOM_STANDFUNKTIONEN_KUNDE_NICHT_IM_FZG"].indexOf(mode)>=0;
 var ready=mode==="KOM_FAHREN"||mode==="KOM_FAHRBEREITSCHAFT_HERSTELLEN"||v.statusConditionVehicle==="FAHREN";
 var stopped=engine.statusCombustionEngineDrive==="MOTOR_STEHT"&&engine.statusMotorDrive==="KEIN_E_MINUS_MASCHINE_VERFUEGBAR";
 var speedValid=speed&&speed.valid===true&&Number.isFinite(speed.value)&&fresh(speed);
 var valid=!!(!this.closed&&fresh(c)&&fresh(e)&&speedValid);
 // This car emits 550–720 ms of KEINE_KOMMUNIKATION between accessory reports.
 // Retain an already corroborated off state for at most 1000 ms through only
 // that mode. Engine start, electric readiness, motion or any other uncertainty
 // still release immediately; this cannot establish off without prior proof.
 var recentOff=Number.isSafeInteger(this.lastOffAtUs)&&now>=this.lastOffAtUs&&now-this.lastOffAtUs<=1000000;
 var off=valid&&!ready&&stopped&&speed.value===0&&(offMode||mode==="KEINE_KOMMUNIKATION"&&recentOff);
 if(off&&offMode)this.lastOffAtUs=c.atUs;else if(!off)this.lastOffAtUs=null;
 return {validated:valid,vehicleOff:!!off,parked:false,driveReady:ready?true:off?false:null,driving:!!(ready||speedValid&&speed.value>0),speedKph:speedValid?speed.value:null,atUs:valid?Math.min(c.atUs,e.atUs,speed.atUs):0,operatingMode:mode||null,engineState:engine.statusCombustionEngineDrive||null,electricState:engine.statusMotorDrive||null,conditionAgeUs:c?now-c.atUs:null,engineAgeUs:e?now-e.atUs:null,offGraceAgeUs:this.lastOffAtUs===null?null:now-this.lastOffAtUs,source:"BMW vehicle operating mode + engine state + speed",reason:off?"Vehicle off verified":ready?"Vehicle is drive-ready":valid?"Vehicle-off state not verified":"Waiting for fresh vehicle-off signals"};
};
function timeout(p,ms){return new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(Error("Vehicle-state subscription timed out"));},ms);Promise.resolve(p).then(function(v){clearTimeout(timer);resolve(v);},function(e){clearTimeout(timer);reject(e);});});}
VehicleState.prototype.profile=function(kind){
 var s=SOURCES[kind],apps=fs.readdirSync(this.profileRoot);
 for(var i=0;i<apps.length;i++){
  if(!/^oap_\d+$/.test(apps[i]))continue;
  var p=path.join(this.profileRoot,apps[i],"someipInterfaces",s.name.replace(/\./g,"_")+".json");
  try{
   var st=fs.lstatSync(p);if(!st.isFile()||st.isSymbolicLink()||st.size>2097152)continue;
   var cfg=JSON.parse(fs.readFileSync(p,"utf8")),f=cfg.fields&&cfg.fields[s.field],schema=f&&f.schema,member=schema&&Array.isArray(schema.e)&&schema.e.filter(function(m){return m.n===s.member;})[0];
   if(cfg.serviceId!==s.serviceId||!cfg.version||cfg.version.major!==1||!member||member.t!=="Enum"||!Object.keys(s.enums).every(function(k){return member.e&&member.e[k]===s.enums[k];}))continue;
   if(kind==="engine"){
    var electric=schema.e.filter(function(m){return m.n==="statusMotorDrive";})[0];
    if(!electric||electric.t!=="Enum"||!electric.e||electric.e.KEIN_E_MINUS_MASCHINE_VERFUEGBAR!==0)continue;
   }
   cfg.methods={};cfg.events={};cfg.fields={};cfg.fields[s.field]=f;return cfg;
  }catch(e){if(e.code!=="ENOENT"&&e.code!=="EACCES"&&!(e instanceof SyntaxError))throw e;}
 }
 throw Error("Validated vehicle-state profile unavailable");
};
VehicleState.prototype.connect=function(){
 if(this.closed||this.connecting)return this.connecting||Promise.resolve();var self=this;
 this.connecting=(async function(){
  var si=self.someip||require("/usr/lib/someip.node");
  for(var kind of Object.keys(SOURCES)){
   if(self.closed)break;if(Object.prototype.hasOwnProperty.call(self.proxies,kind)||(self.attempts[kind]||0)>=3)continue;
   self.attempts[kind]=(self.attempts[kind]||0)+1;var p=null;
   try{
    p=await timeout(si.buildProxy(self.profile(kind),"1"),4000);self.proxies[kind]=p;
    await timeout(p.init(),4000);if(self.closed)break;self.subscriptions[kind]=p;
    await (function(k,proxy){return timeout(proxy.subscribe({name:SOURCES[k].field,onReceive:function(value){if(self.proxies[k]===proxy&&self.subscriptions[k]===proxy)self.receive(k,value);}}),4000);})(kind,p);
   }catch(e){
    delete self.subscriptions[kind];delete self.samples[kind];
    if(!p)delete self.proxies[kind];
    else {
     // Retry only after retiring the failed proxy. If shutdown is uncertain,
     // retain it to avoid duplicate native subscriptions on future attempts.
     try{if(!p.shutdown)throw Error("Cannot retire proxy");await timeout(p.shutdown(),2000);delete self.proxies[kind];}catch(ignore){}
    }
   }
  }
 })().catch(function(){}).then(function(){self.connecting=null;});return this.connecting;
};
VehicleState.prototype.start=function(){var self=this;function loop(){if(self.closed)return;self.connect().then(function(){if(!self.closed){self.timer=setTimeout(loop,10000);if(self.timer.unref)self.timer.unref();}});}loop();};
VehicleState.prototype.close=async function(){this.closed=true;clearTimeout(this.timer);if(this.connecting)await this.connecting;var self=this;await Promise.all(Object.keys(this.proxies).map(function(k){var p=self.proxies[k];return p&&p.shutdown?timeout(p.shutdown(),2000).catch(function(){}):Promise.resolve();}));};
module.exports={VehicleState:VehicleState};
