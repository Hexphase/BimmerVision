"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const signals=require('../recorder/files/oem-signals'),{Telemetry}=require('../recorder/files/telemetry');
const {Recorder}=require('../recorder/files/recorder'),archive=require('../recorder/files/archive');
const schema={t:'Struct',e:[{n:'operationHornButton',t:'Enum',w:1,e:{HORN_MINUS_TASTER_GEDRUECKT:1,KEINE_AKTION:0,SIGNAL_UNGUELTIG:3}}]};
const source={name:'de.bmw.infrastructure.analytics.BasicDataSet',kind:'horn'};
test('horn follows schema enum names and rejects invalid or absent values',()=>{
 assert.deepEqual(signals.readSignal('horn',schema,{operationHornButton:1}),{horn:true});
 assert.deepEqual(signals.readSignal('horn',schema,{operationHornButton:'KEINE_AKTION'}),{horn:false});
 for(const value of [3,2,255,null,undefined])assert.equal(signals.readSignal('horn',schema,{operationHornButton:value}),null);
 assert.equal(signals.readSignal('horn',null,{operationHornButton:1}),null);
 const changed={e:[{n:'operationHornButton',e:{HORN_MINUS_TASTER_GEDRUECKT:7,KEINE_AKTION:8}}]};
 assert.deepEqual(signals.readSignal('horn',changed,{operationHornButton:7}),{horn:true});
 assert.equal(signals.readSignal('horn',changed,{operationHornButton:1}),null);
});
test('horn metadata expires rather than latching a held or released state forever',()=>{
 const t=new Telemetry();t.take(source,{horn:true},1000000);
 assert.equal(t.snapshot(1000000).horn.value,true);assert.equal(t.snapshot(1000000).horn.valid,true);
 assert.equal(t.snapshot(3000001).horn.valid,false);assert.equal(t.snapshot(999999).horn.valid,false);
 t.take(source,{horn:false},4000000);assert.equal(t.snapshot(4000000).horn.value,false);
 t.take(source,null,4100000);assert.equal(t.snapshot(4100000).horn.valid,false);
});
test('press and release timestamps survive a real recording archive',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bv-horn-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let now=1000000;const rec=new Recorder({root,guard:{check:async()=>{}},nowUs:()=>now,reorderWindow:0});
 const telemetry=new Telemetry({onEvent:(e,time)=>rec.event(e,time)});
 try{
 const b=Buffer.alloc(14);b[0]=128;b[1]=224;b.writeUInt16BE(1,2);b.writeUInt32BE(1,8);b[12]=0x65;b[13]=0x88;
 rec.packet(b,now);while(rec.running)await rec.running;
 telemetry.take(source,signals.readSignal('horn',schema,{operationHornButton:1}),1100000);
 telemetry.take(source,signals.readSignal('horn',schema,{operationHornButton:0}),1500000);
 now=1600000;await rec.stop('test');assert.equal(rec.error,null);
 const dir=fs.readdirSync(root).find(n=>fs.statSync(path.join(root,n)).isDirectory());
 const scan=archive.scan(fs.readFileSync(path.join(root,dir,'capture.bvr')));assert.equal(scan.error,null);
 const horn=scan.records.filter(r=>r.type===2).map(r=>JSON.parse(r.payload)).filter(e=>e.type==='telemetry'&&e.fields.horn).map(e=>[e.fields.horn.value,e.fields.horn.atUs,e.fields.horn.valid]);
 assert.deepEqual(horn,[[true,1100000,true],[false,1500000,true]]);
 }finally{await rec.stop('cleanup');telemetry.stop();}
});
test('legacy telemetry profiles still subscribe to the new read-only horn source',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bv-horn-legacy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const original=path.join(root,'legacy'),profile=path.join(root,'profiles'),dir=path.join(profile,'oap_1','someipInterfaces');
 fs.mkdirSync(path.join(original,'node_modules','someip'),{recursive:true});fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(original,'record-clip.js'),'exports.SOURCES=[]; exports.readSignal=function(){throw Error("legacy validator cannot decode horn");};');
 fs.writeFileSync(path.join(original,'node_modules','someip','index.js'),'exports.buildProxy=function(cfg,instance){if(cfg.serviceId!==4096||instance!=="1"||Object.keys(cfg.methods).length)throw Error("incorrect horn subscription");return {init:function(){return Promise.resolve();},subscribe:function(o){if(o.name!=="basicDataSet")throw Error("wrong field");o.onReceive({operationHornButton:1});return Promise.resolve();}};};');
 fs.writeFileSync(path.join(dir,'de_bmw_infrastructure_analytics_BasicDataSet.json'),JSON.stringify({serviceId:4096,methods:{mustNotCall:{}},fields:{basicDataSet:{schema,event:{id:32769,groups:[1]}}}}));
 const telemetry=new Telemetry({profileRoot:profile,nowUs:()=>1000000});t.after(()=>telemetry.stop());
 await telemetry.connect(original);assert.equal(telemetry.snapshot(1000000).horn.value,true);assert.equal(telemetry.snapshot(1000000).horn.valid,true);
 const hornSource=signals.SOURCES.find(s=>s.kind==='horn');assert.equal(hornSource.serviceId,4096);assert.equal(hornSource.field,'basicDataSet');
});
