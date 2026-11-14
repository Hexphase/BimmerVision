'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),{createRequire}=require('module'),{Writable}=require('stream');
const source=path.resolve(__dirname,'../recorder/files/transfer.js');
// Exercise the real transfer handler and file stream; advance its pacing timers
// immediately so assertions do not depend on a busy machine's wall clock.
async function download(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-speed-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'capture.bvr'),bytes=Buffer.alloc(1048576,83);fs.writeFileSync(file,bytes);
 let sent=0,checks=0,released=0;const delays=[],chunks=[];let queued=options.backlog?512:0;
 const module={exports:{}};const sandbox={module,exports:module.exports,require:createRequire(source),Buffer,process,console,URL,setTimeout:(fn,ms)=>{delays.push({ms,sent,queued});if(ms===25)queued=0;return setTimeout(fn,0);},clearTimeout};
 vm.runInNewContext(fs.readFileSync(source,'utf8'),sandbox,{filename:source});
 const status=()=>{checks++;return options.recordingAfterFirstChunk&&sent>0?{activeId:'active',writeInProgress:true,metrics:{queuedBytes:queued}}:{activeId:null,writeInProgress:false,metrics:{queuedBytes:queued}};};
 const transfer=new module.exports.Transfer({library:{acquire:async()=>()=>released++,resolve:async()=>file},status,...options.transfer});
 transfer.alive=()=>true;transfer.acceptHost=()=>true;transfer.session={token:'test'};transfer.auth=()=>transfer.session;
 const response=new Writable({highWaterMark:16384,write(chunk,encoding,done){sent+=chunk.length;chunks.push(Buffer.from(chunk));setImmediate(done);}});response.setHeader=()=>{};response.writeHead=()=>{};
 await transfer.handle({method:'GET',url:'/api/v1/recordings/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/capture.bvr',headers:{}},response,0);
 assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(released,1);assert.equal(transfer.active,0);
 return {delays,checks};
}
test('idle complete-clip download has no artificial bandwidth sleep',async t=>{
 const result=await download(t);assert.deepEqual(result.delays.filter(x=>x.ms>0),[]);
 assert.ok(result.checks>1,'USB/capture status is rechecked during transfer');
 assert.ok(result.checks<=8,'idle reads avoid repeating metadata checks on tiny 32 KB chunks');
});
test('starting capture during an idle download restores pacing and yields to backlog',async t=>{
 const result=await download(t,{recordingAfterFirstChunk:true,backlog:true});
 assert.ok(result.delays.some(x=>x.ms===25&&x.queued>0),'backlog gets priority before reading');
 assert.ok(result.delays.some(x=>x.ms>25&&x.sent>0),'active recording restores bounded transfer rate');
});
test('an explicit bandwidth limit still applies while idle',async t=>{
 const result=await download(t,{transfer:{bytesPerSecond:32768}});assert.ok(result.delays.some(x=>x.ms>=1000));
});
