'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path').join(__dirname,'../recorder/files/mobile-web/speed-limit-client.js');
function client(fetch,clock={now:()=>100000}) {
 assert.ok(fs.existsSync(path),'device speed-limit client exists');
 const box={module:{exports:{}},fetch,AbortController,setTimeout,clearTimeout,Date:clock,TextDecoder};
 vm.runInNewContext(fs.readFileSync(path,'utf8'),box);return box.module.exports;
}
const way=(tags={})=>({type:'way',id:1,tags:{highway:'residential',maxspeed:'25 mph',...tags},geometry:[{lat:32,lon:-95.001},{lat:32,lon:-94.999}]});
test('device lookup reads explicit nearby OSM tags without car credentials and caches requests',async()=>{
 let calls=0;const c=client(async(url,opts)=>{calls++;assert.equal(new URL(url).host,'overpass-api.de');assert.equal(opts.credentials,'omit');assert.equal(opts.referrerPolicy,'no-referrer');assert.equal(opts.headers,undefined);return {ok:true,text:async()=>JSON.stringify({elements:[way()]})};});
 const first=await c.lookup(32,-95);assert.equal(first.limit,25);assert.equal(first.unit,'mph');assert.equal(first.isEstimated,false);assert.equal((await c.lookup(32,-95)).limit,25);assert.equal(calls,1);
});
test('device lookup never infers defaults or accepts ambiguous, conditional, far roads or partial results',async()=>{
 for(const doc of [{elements:[way({maxspeed:undefined})]},{elements:[way(),way()]},{elements:[way({'maxspeed:conditional':'15 @ school'})]},{elements:[{...way(),geometry:[{lat:33,lon:-95},{lat:33,lon:-94}]}]},{remark:'timeout',elements:[way()]}]){
  const c=client(async()=>({ok:true,text:async()=>JSON.stringify(doc)}));assert.equal(await c.lookup(32,-95),null);
 }
});
test('device failures are cached and global rate limit prevents per-frame queries',async()=>{
 let calls=0,now=100000;const c=client(async()=>{calls++;throw Error('offline');},{now:()=>now});
 assert.equal(await c.lookup(32,-95),null);assert.equal(await c.lookup(32,-95),null);assert.equal(await c.lookup(32.001,-95),null);assert.equal(calls,1);
 now+=31000;assert.equal(await c.lookup(32,-95),null);assert.equal(calls,2);
});
test('aborted device replies cannot populate the cache',async()=>{
 let finish,calls=0;const c=client(()=>{calls++;return new Promise(r=>{finish=r;});});const abort=new AbortController();const pending=c.lookup(32,-95,abort.signal);abort.abort();finish({ok:true,text:async()=>JSON.stringify({elements:[way()]})});assert.equal(await pending,null);
});

test('device deadline releases single-flight even when the response body ignores abort',async()=>{
 let timeout,now=100000,calls=0;
 const box={module:{exports:{}},AbortController,Date:{now:()=>now},TextDecoder,setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){},fetch:async()=>{calls++;return {ok:true,text:()=>new Promise(()=>{}),json:()=>new Promise(()=>{})};}};
 vm.runInNewContext(fs.readFileSync(path,'utf8'),box);const pending=box.module.exports.lookup(32,-95);await new Promise(r=>setImmediate(r));timeout();assert.equal(await pending,null);
 now+=11000;const next=box.module.exports.lookup(32.001,-95);await new Promise(r=>setImmediate(r));timeout();assert.equal(await next,null);assert.equal(calls,2);
});
test('oversized device response is rejected and its reader cancelled',async()=>{
 let cancelled=false;const c=client(async()=>({ok:true,body:{getReader:()=>({read:async()=>({value:new Uint8Array(1048577),done:false}),cancel:async()=>{cancelled=true;},releaseLock(){}})}}));assert.equal(await c.lookup(32,-95),null);assert.equal(cancelled,true);
});
