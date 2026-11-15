'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events'),{MapTiles}=require('../recorder/files/map-tiles');
test('tile requests use the Node 8 options/callback signature and cache valid images',async t=>{
 const cache=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'bv-tiles-')));t.after(()=>fs.rmSync(cache,{recursive:true,force:true}));let calls=0;
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(16)]);
 const tiles=new MapTiles({cache,request(options,callback){calls++;assert.equal(typeof options,'object');assert.equal(typeof callback,'function');assert.equal(options.hostname,'tile.openstreetmap.org');assert.equal(options.path,'/0/0/0.png');assert.match(options.headers['User-Agent'],/BimmerVision/);const req=new EventEmitter();req.setTimeout=()=>{};process.nextTick(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'image/png'};callback(res);res.emit('data',png);res.emit('end');});return req;}});
 assert.deepEqual(await tiles.read(0,0,0),png);assert.deepEqual(await tiles.read(0,0,0),png);assert.equal(calls,1);
});
