'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const rtp=require('../recorder/files/rtp'),archive=require('../recorder/files/archive'),{Recorder}=require('../recorder/files/recorder');
function packet(sequence,payload){const b=Buffer.alloc(12+payload.length);b[0]=128;b[1]=224;b.writeUInt16BE(sequence,2);b.writeUInt32BE(sequence*3000,4);b.writeUInt32BE(1,8);Buffer.from(payload).copy(b,12);return b;}
test('recording reuses one validated RTP header through dependency tracking without retaining caller buffers',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-reuse-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const originalParse=rtp.parsePacket;let parses=0;rtp.parsePacket=b=>{parses++;return originalParse(b);};t.after(()=>{rtp.parsePacket=originalParse;});
 const r=new Recorder({root,guard:{check:async()=>{}},nowUs:()=>1000000});
 const packets=[packet(1,[0x67,0x42,0,0x1f]),packet(2,[0x68,0xce,0x38]),packet(3,[0x65,0x88]),packet(4,[0x61,0xe0])],expected=packets.map(b=>Buffer.from(b));
 try{
  for(let i=0;i<packets.length;i++){assert.equal(r.packet(packets[i],1000000+i*1000),true);packets[i].fill(0);}
  await r.stop('test');assert.equal(r.error,null);
  const dir=path.join(root,fs.readdirSync(root).find(n=>/^[a-f0-9-]{36}$/.test(n))),scan=archive.scan(fs.readFileSync(path.join(dir,'capture.bvr'))),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
  assert.equal(scan.error,null);assert.equal(scan.truncated,false);assert.deepEqual(scan.records.filter(x=>x.type===1).map(x=>x.payload),expected);
  assert.equal(manifest.packets,4);assert.equal(manifest.requiresPrevious,false);assert.ok(manifest.recoveryInfo['1']);
  assert.equal(parses,4,'each archived packet is parsed once, then shared by ingress and durable dependency trackers');
 }finally{await r.stop('cleanup');}
});
test('packet reuse keeps dependent prefixes and malformed packet losses conservative',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-reuse-loss-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const r=new Recorder({root,guard:{check:async()=>{}},nowUs:()=>1000000});
 const malformed=Buffer.from('not rtp'),packets=[packet(1,[0x61,0xe0]),packet(2,[0x67,0x42,0,0x1f]),packet(3,[0x68,0xce,0x38]),packet(4,[0x65,0x88]),packet(6,[0x61,0xe0]),malformed];
 try{
  packets.forEach((p,i)=>r.packet(p,1000000+i*1000));await r.stop('test');assert.equal(r.error,null);
  const dir=path.join(root,fs.readdirSync(root).find(n=>/^[a-f0-9-]{36}$/.test(n))),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),scan=archive.scan(fs.readFileSync(path.join(dir,'capture.bvr')));
  assert.equal(manifest.requiresPrevious,true);assert.equal(manifest.packets,6);assert.equal(manifest.observedSequenceGaps,1);
  assert.deepEqual(scan.records.filter(x=>x.type===1).map(x=>x.payload),packets);
  const losses=scan.records.filter(x=>x.type===2).map(x=>JSON.parse(x.payload));
  assert.ok(losses.some(x=>x.reason==='malformed-rtp'));assert.ok(losses.some(x=>x.reason==='rtp-sequence-gap'&&x.packets===1));
 }finally{await r.stop('cleanup');}
});
