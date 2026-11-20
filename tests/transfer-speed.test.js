'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),{createRequire}=require('module'),{Writable}=require('stream');
const source=path.resolve(__dirname,'../recorder/files/transfer.js');
// Exercise the real transfer handler and file stream; advance its pacing timers
// immediately so assertions do not depend on a busy machine's wall clock.
async function download(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bv-speed-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'capture.bvr'),bytes=Buffer.alloc(options.byteCount||1048576,83);fs.writeFileSync(file,bytes);
 let sent=0,checks=0,released=0;const delays=[],chunks=[];let queued=options.backlog?512:0;
 const module={exports:{}};const sandbox={module,exports:module.exports,require:createRequire(source),Buffer,process,console,URL,setTimeout:(fn,ms)=>{delays.push({ms,sent,queued});if(ms===25)queued=0;return setTimeout(fn,0);},clearTimeout};
 vm.runInNewContext(fs.readFileSync(source,'utf8'),sandbox,{filename:source});
 const status=()=>{checks++;return options.recordingAfterFirstChunk&&sent>0?{activeId:'active',writeInProgress:true,metrics:{queuedBytes:queued}}:{activeId:null,writeInProgress:false,metrics:{queuedBytes:queued}};};
 const transfer=new module.exports.Transfer({library:{acquire:async()=>()=>released++,resolve:async()=>file},status,...options.transfer});
 transfer.alive=()=>true;transfer.acceptHost=()=>true;transfer.session={token:'test'};transfer.auth=()=>transfer.session;
 const response=new Writable({highWaterMark:16384,write(chunk,encoding,done){sent+=chunk.length;chunks.push(Buffer.from(chunk));setImmediate(done);}});response.setHeader=()=>{};response.writeHead=()=>{};
 await transfer.handle({method:'GET',url:'/api/v1/recordings/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/capture.bvr',headers:{}},response,0);
 assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(released,1);assert.equal(transfer.active,0);
 return {delays,checks,download:transfer.info().download};
}
test('idle complete-clip download has no artificial bandwidth sleep',async t=>{
 const result=await download(t);assert.deepEqual(result.delays.filter(x=>x.ms>0),[]);
 assert.ok(result.checks>1,'USB/capture status is rechecked during transfer');
 assert.ok(result.checks<=8,'idle reads avoid repeating metadata checks on tiny 32 KB chunks');
 assert.equal(result.download.totalBytes,1048576);assert.equal(result.download.sentBytes,1048576);assert.equal(result.download.complete,true);assert.equal(result.download.paced,false);assert.ok(result.download.bytesPerSecond>0);
});
test('starting capture during an idle download restores pacing and yields to backlog',async t=>{
 const result=await download(t,{recordingAfterFirstChunk:true,backlog:true,byteCount:2097152});
 assert.ok(result.delays.some(x=>x.ms===25&&x.queued>0),'backlog gets priority before reading');
 assert.ok(result.delays.some(x=>x.ms>25&&x.sent>0),'active recording restores bounded transfer rate');
});
test('an explicit bandwidth limit still applies while idle',async t=>{
 const result=await download(t,{transfer:{bytesPerSecond:32768}});assert.ok(result.delays.some(x=>x.ms>=1000));
});
test('phone broker bounded reads require paired mutation auth and return binary bytes',async()=>{const {Transfer}=require(source);const calls=[];const transfer=new Transfer({library:{},backup:{phoneRequest:async(action,job,body)=>{calls.push({action,job,body});return Buffer.from('abc');}}});transfer.alive=()=>true;transfer.acceptHost=()=>true;transfer.auth=(req,mutation)=>{assert.equal(mutation,true);return transfer.session;};transfer.session={token:'test'};transfer.body=async()=>({leaseToken:'secret',index:0,offset:0,length:3});const chunks=[];const res={setHeader(){},writeHead(status,headers){assert.equal(status,200);assert.equal(headers['Content-Type'],'application/octet-stream');},end(bytes){chunks.push(bytes);}};await transfer.handle({method:'POST',url:'/api/v1/phone-backup/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/read',headers:{}},res,0);assert.equal(calls[0].action,'read');assert.equal(chunks[0].toString(),'abc');});

test('whole-drive enqueue uses paired mutation auth and a bounded 60 KiB JSON body',async()=>{
 const {Transfer}=require(source);const calls=[];
 const transfer=new Transfer({library:{},backup:{phoneRequest:async(action,job,body)=>{calls.push({action,job,body});return {queued:1000,pending:true};}}});
 transfer.alive=()=>true;transfer.acceptHost=()=>true;transfer.session={token:'test'};
 transfer.auth=(req,mutation)=>{assert.equal(mutation,true);return transfer.session;};
 transfer.body=async(req,limit)=>{assert.equal(limit,60*1024);return {clipIds:['selected'],consent:true};};
 let result;const res={setHeader(){},writeHead(status){assert.equal(status,200);},end(bytes){result=JSON.parse(bytes);}};
 await transfer.handle({method:'POST',url:'/api/v1/phone-backup/enqueue',headers:{}},res,0);
 assert.equal(calls[0].action,'enqueue');assert.deepEqual(result,{queued:1000,pending:true});
});
test('Remote Backup queue API uses paired read/mutation auth and bounds queue selections',async()=>{const {Transfer}=require(source);let mutation,bodySize,called;const t=new Transfer({library:{},backup:{queueRequest:async(body,change)=>{called={body,change};return {ok:true};}}});t.alive=()=>true;t.acceptHost=()=>true;t.session={token:'test'};t.auth=(req,m)=>{mutation=m;return t.session;};t.body=async(req,size)=>{bodySize=size;return {action:'remove',clipIds:['selected']};};const res={setHeader(){},writeHead(code){assert.equal(code,200);},end(){}};await t.handle({method:'GET',url:'/api/v1/remote-backup',headers:{}},res,0);assert.equal(mutation,false);assert.equal(called.change,false);await t.handle({method:'POST',url:'/api/v1/remote-backup/queue',headers:{}},res,0);assert.equal(mutation,true);assert.equal(bodySize,60*1024);assert.equal(called.change,true);});

test("idle downloads revalidate at bounded one-MiB intervals to avoid repeated tiny filesystem work",async t=>{const result=await download(t);assert.ok(result.checks<=3,"idle1MiB should need only initial and chunk-boundary checks, got "+result.checks);assert.equal(result.download.complete,true);});
test('paired phone preparation gets bounded response time beyond ordinary idle timeout after its body is received',async()=>{const {Transfer}=require(source),timeouts=[];const t=new Transfer({library:{},backup:{phoneRequest:async()=>({jobId:'job'})}});t.alive=()=>true;t.acceptHost=()=>true;t.session={token:'test'};t.auth=()=>t.session;t.body=async()=>({clipIds:['selected']});const res={setHeader(){},writeHead(){},end(){}};await t.handle({method:'POST',url:'/api/v1/phone-backup/claim',headers:{},socket:{setTimeout:ms=>timeouts.push(ms)}},res,0);assert.deepEqual(timeouts,[10000,600000]);});
