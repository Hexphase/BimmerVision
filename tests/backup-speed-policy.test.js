"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{permitted}=require("../recorder/files/backup-speed-policy");
test("stationarity requires fresh validated zero speed, allowing only 0.1 mph telemetry noise",()=>{
 const s={valid:true,value:0,unit:"km/h",atUs:1000000};
 for(const value of [0,0.05,0.1609344])assert.equal(permitted({...s,value},1000000),true);
 for(const value of [0.160935,1,5,16.09344,20,-1,NaN,Infinity])assert.equal(permitted({...s,value},1000000),false);
 assert.equal(permitted({...s,value:0.1,unit:"mph"},1000000),true);assert.equal(permitted({...s,value:0.100001,unit:"mph"},1000000),false);
 for(const patch of [{valid:false},{unit:""},{unit:"unknown"},{atUs:1000001}])assert.equal(permitted({...s,...patch},1000000),false);
 assert.equal(permitted(s,3000001),false);assert.equal(permitted(null,1000000),false);
});
