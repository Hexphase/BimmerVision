"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {VehicleState}=require("../recorder/files/backup-vehicle-state");
function fixture(){let now=1000000;const p=new VehicleState({nowUs:()=>now});const speed=()=>({valid:true,value:0,atUs:now,unit:"km/h"});return {p,speed,setNow:n=>{now=n}};}
test("vehicle-off pause needs fresh accessory mode, stopped engine and zero speed together",()=>{
 const f=fixture();assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);
 f.p.receive("condition",{controlBasePartialNetworks:"KOM_WOHNEN",statusConditionVehicle:"WOHNEN",qualifierStatusConditionVehicle:"WERT_NICHT_VERFUEGBAR"});
 f.p.receive("engine",{statusCombustionEngineDrive:"MOTOR_STEHT",statusMotorDrive:"KEIN_E_MINUS_MASCHINE_VERFUEGBAR"});
 const s=f.p.snapshot(f.speed());assert.equal(s.validated,true);assert.equal(s.vehicleOff,true);assert.equal(s.driveReady,false);assert.equal(s.parked,false);
 assert.equal(f.p.snapshot({...f.speed(),value:1}).vehicleOff,false);
 assert.equal(f.p.snapshot({...f.speed(),valid:false}).validated,false);
 f.setNow(4000000);assert.equal(f.p.snapshot(f.speed()).validated,false);
});
test("auto stop/start, startup, invalid enums and contradictory states never count as vehicle off",()=>{
 const f=fixture();f.p.receive("engine",{statusCombustionEngineDrive:"MOTOR_STEHT",statusMotorDrive:"KEIN_E_MINUS_MASCHINE_VERFUEGBAR"});
 f.p.receive("condition",{controlBasePartialNetworks:"KOM_FAHREN",statusConditionVehicle:"FAHREN"});
 assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);assert.equal(f.p.snapshot(f.speed()).driveReady,true);
 for(const mode of ["KOM_FAHRBEREITSCHAFT_HERSTELLEN","KOM_FAHRBEREITSCHAFT_BEENDEN","SIGNAL_UNBEFUELLT",2]){f.p.receive("condition",{controlBasePartialNetworks:mode});assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);}
 f.p.receive("condition",{controlBasePartialNetworks:"KOM_WOHNEN",statusConditionVehicle:"FAHREN"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);
 f.p.receive("condition",{controlBasePartialNetworks:"KOM_WOHNEN",statusConditionVehicle:"WOHNEN"});
 for(const engine of ["MOTOR_STARTET","MOTOR_LAEUFT","SIGNAL_UNBEFUELLT",0]){f.p.receive("engine",{statusCombustionEngineDrive:engine,statusMotorDrive:"KEIN_E_MINUS_MASCHINE_VERFUEGBAR"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);}
});
test("vehicle subscriptions recover after init and subscribe failures and ignore retired callbacks",async()=>{
 for(const failure of ["init","subscribe"]){
  let builds=0,stops=0;const callbacks=[];
  const p=new VehicleState({someip:{buildProxy:async()=>{
   const first=builds++<2;
   return {init:async()=>{if(first&&failure==="init")throw Error("starting");},subscribe:async o=>{callbacks.push(o.onReceive);if(first&&failure==="subscribe")throw Error("not ready");},shutdown:async()=>{stops++;}};
  }}});
  p.profile=()=>({});await p.connect();assert.equal(Object.keys(p.proxies).length,0);assert.equal(stops,2);
  await p.connect();assert.equal(Object.keys(p.proxies).length,2);assert.equal(builds,4);
  if(failure==="subscribe"){callbacks[0]({stale:true});assert.equal(p.samples.condition,undefined);}
  callbacks[callbacks.length-2]({fresh:true});assert.equal(p.samples.condition.value.fresh,true);
  await p.close();assert.equal(stops,4);
 }
});
test("one source failing to build does not retire the other source's proxy",async()=>{
 let builds=0,conditionStops=0;
 const p=new VehicleState({someip:{buildProxy:async()=>{if(++builds===2)throw Error("engine unavailable");return {init:async()=>{},subscribe:async()=>{},shutdown:async()=>{conditionStops++;}};}}});
 p.profile=()=>({});await p.connect();assert.equal(conditionStops,0);assert.deepEqual(Object.keys(p.proxies),["condition"]);
 await p.connect();assert.equal(builds,3);assert.equal(conditionStops,0);assert.equal(Object.keys(p.proxies).length,2);await p.close();
});
test("brief no-communication mode after verified off is bounded and cannot mask engine start or motion",()=>{
 const f=fixture();
 const off={controlBasePartialNetworks:"KOM_WOHNEN",statusConditionVehicle:"WOHNEN"},engine={statusCombustionEngineDrive:"MOTOR_STEHT",statusMotorDrive:"KEIN_E_MINUS_MASCHINE_VERFUEGBAR"};
 f.p.receive("condition",off);f.p.receive("engine",engine);assert.equal(f.p.snapshot(f.speed()).vehicleOff,true);
 f.setNow(1200000);f.p.receive("condition",{controlBasePartialNetworks:"KEINE_KOMMUNIKATION"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,true);
 assert.equal(f.p.snapshot({...f.speed(),value:1}).vehicleOff,false);
 f.p.receive("engine",{...engine,statusCombustionEngineDrive:"MOTOR_STARTET"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);
 f.p.receive("engine",engine);f.p.receive("condition",{controlBasePartialNetworks:"KEINE_KOMMUNIKATION",statusConditionVehicle:"FAHREN"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);
 f.p.receive("condition",{controlBasePartialNetworks:"SIGNAL_UNBEFUELLT"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);
 f.p.receive("condition",{controlBasePartialNetworks:"KEINE_KOMMUNIKATION"});f.setNow(2000001);assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);
 const never=fixture();never.p.receive("engine",engine);never.p.receive("condition",{controlBasePartialNetworks:"KEINE_KOMMUNIKATION"});assert.equal(never.p.snapshot(never.speed()).vehicleOff,false);
});
test("repeated no-communication events cannot extend the off grace period",()=>{
 const f=fixture();f.p.receive("condition",{controlBasePartialNetworks:"KOM_WOHNEN"});f.p.receive("engine",{statusCombustionEngineDrive:"MOTOR_STEHT",statusMotorDrive:"KEIN_E_MINUS_MASCHINE_VERFUEGBAR"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,true);
 for(const at of [1250000,1500000,1999999]){f.setNow(at);f.p.receive("condition",{controlBasePartialNetworks:"KEINE_KOMMUNIKATION"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,true);}
 f.setNow(2000001);f.p.receive("condition",{controlBasePartialNetworks:"KEINE_KOMMUNIKATION"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);
 f.setNow(2100000);f.p.receive("condition",{controlBasePartialNetworks:"KEINE_KOMMUNIKATION"});assert.equal(f.p.snapshot(f.speed()).vehicleOff,false);
});
test("unsafe events between policy polls clear remembered off immediately",()=>{
 for(const [kind,value] of [["condition",{controlBasePartialNetworks:"KOM_WOHNEN",statusConditionVehicle:"FAHREN"}],["condition",{controlBasePartialNetworks:"KOM_FAHRBEREITSCHAFT_HERSTELLEN"}],["condition",{controlBasePartialNetworks:"SIGNAL_UNBEFUELLT"}],["engine",{statusCombustionEngineDrive:"MOTOR_STARTET",statusMotorDrive:"KEIN_E_MINUS_MASCHINE_VERFUEGBAR"}],["engine",{statusCombustionEngineDrive:"MOTOR_STEHT",statusMotorDrive:"E_MINUS_MASCHINE_IST_ELEKTRISCH_FAHRBEREIT_ODER_BEREITS_AKTIV"}]]){
  const f=fixture(),engine={statusCombustionEngineDrive:"MOTOR_STEHT",statusMotorDrive:"KEIN_E_MINUS_MASCHINE_VERFUEGBAR"};f.p.receive("condition",{controlBasePartialNetworks:"KOM_WOHNEN"});f.p.receive("engine",engine);assert.equal(f.p.snapshot(f.speed()).vehicleOff,true);
  f.setNow(1900000);f.p.receive(kind,value);f.setNow(2100000);f.p.receive("condition",{controlBasePartialNetworks:"KEINE_KOMMUNIKATION"});f.p.receive("engine",engine);assert.equal(f.p.snapshot(f.speed()).vehicleOff,false,JSON.stringify(value));
 }
});
