'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('persistent low available memory warns and clears when available memory recovers',()=>{
 const Pressure=require('../recorder/files/head-unit-resources').Pressure,p=new Pressure();
 const sample=availableBytes=>({memoryBytes:{availableBytes,totalBytes:2000000000}});
 assert.equal(p.update(sample(40000000),0),'');
 assert.match(p.update(sample(40000000),5000),/memory/);
 assert.equal(p.update(sample(800000000),10000),'');
});
test('chime releases its own overlay route even if playback fails',async()=>{
 const {play}=require('../idrive/src/alert-chime');let released;
 const route={connect:async()=>({amError:'E_OK',mainConnectionID:7}),disconnect:async p=>{released=p;}};
 await assert.rejects(play(route,{playFile:async()=>{throw Error('offline');}},async()=>{}),/offline/);
 assert.deepEqual(released,{mainConnectionID:7});
});
test('CPU warning uses interval deltas and excludes time waiting for I/O',()=>{
 const Pressure=require('../recorder/files/head-unit-resources').Pressure,p=new Pressure();
 function sample(user,ioWait,now){return p.update({cpuTicks:{user,idle:2,ioWait}},now);}
 assert.equal(sample(100,0,0),'');assert.equal(sample(200,0,5000),'');
 assert.match(sample(300,0,10000),/CPU busy/);
 assert.equal(sample(301,98,15000),'');
});
test('notification PCM gets a modest gain with peak headroom',()=>{
 const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);b.writeInt16LE(10000,44);b.writeInt16LE(-10000,46);
 require('../idrive/src/alert-chime').boost(b);assert.equal(b.readInt16LE(44),11885);assert.equal(b.readInt16LE(46),-11885);
});
