'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CarBackupBridge,validateRequest}=require('../recorder/files/mobile-web/car-backup-bridge');
const PhoneBridgeSource=require('./fixtures/phone-bridge-source');
const ORIGIN='http://192.168.100.1:8765',PUBLIC='https://bimmervision.app',ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NONCE='1'.repeat(64);
function surface(origin){const listeners=new Map();return {location:{origin},closed:false,addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},removeEventListener(type,fn){listeners.get(type)?.delete(fn);},emit(type,event){for(const fn of [...listeners.get(type)||[]])fn(event);}};}
function fixture(fetcher=async()=>Response.json({ok:true})){const carWindow=surface(ORIGIN),phoneWindow=surface(PUBLIC),calls=[];
 const send=(to,message,origin,source,transfer)=>queueMicrotask(()=>to.emit('message',{data:structuredClone(message,transfer?{transfer}:undefined),origin,source}));
 const popup={closed:false,location:{href:''},postMessage(message,target,transfer){assert.equal(target,PUBLIC);send(phoneWindow,message,ORIGIN,opener,transfer);}},opener={closed:false,postMessage(message,target,transfer){assert.equal(target,ORIGIN);send(carWindow,message,PUBLIC,popup,transfer);}};
 const source={kind:'car',fetch:async(path,options)=>{calls.push({path,options});return fetcher(path,options);}},listeners=new Set(),manager={source,generation:1,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
 const bridge=new CarBackupBridge({window:carWindow,manager,popup,ids:[ID],nonce:NONCE});
 return {bridge,manager,source,popup,opener,carWindow,phoneWindow,calls,async connect(){const ready=bridge.open();const remote=await PhoneBridgeSource.connect({origin:ORIGIN,nonce:NONCE,opener,window:phoneWindow});await ready;return remote;},changeSource(){manager.source={kind:'usb'};manager.generation++;listeners.forEach(fn=>fn());}};
}
test('bridge handshakes exact selection and transfers bounded bytes without car credentials',async()=>{
 const f=fixture(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'application/octet-stream','Set-Cookie':'secret','Authorization':'secret'}})),remote=await f.connect();
 try{assert.equal(remote.kind,'car');assert.deepEqual(remote.selectedIds,[ID]);const response=await remote.fetch('/api/v1/phone-backup/'+'a'.repeat(32)+'/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leaseToken:'scoped',index:0,offset:0,length:3})});assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3]);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Authorization'),null);assert.equal(f.calls[0].options.headers.Authorization,undefined);assert(!f.popup.location.href.includes(ID));assert(!f.popup.location.href.includes('code='));}
 finally{remote.close();f.bridge.close();}
});
test('only narrow API paths, bounded JSON and safe one-MiB read ranges are admitted',()=>{
 for(const path of ['https://evil.example/api/v1/phone-backup','/api/v1/recordings','/api/v1/status','/api/v1/pair','/api/v1/phone-backup/link','/api/v1/phone-backup?token=x','/api/v1/phone-backup/../status'])assert.throws(()=>validateRequest({path,method:'GET'}));
 const path='/api/v1/phone-backup/'+'a'.repeat(32)+'/read';
 for(const body of [{index:-1,offset:0,length:1},{index:0,offset:-1,length:1},{index:0,offset:0,length:1048577},{index:0,offset:1.1,length:1},{index:'0',offset:0,length:1}])assert.throws(()=>validateRequest({path,method:'POST',body:JSON.stringify(body)}));
 assert.throws(()=>validateRequest({path:'/api/v1/phone-backup/enqueue',method:'POST',body:JSON.stringify({value:'x'.repeat(61440)})}));
 assert.throws(()=>validateRequest({path:'/api/v1/phone-backup',method:'GET',headers:{Authorization:'secret'}}));
});
test('source changes abort in-flight requests and disconnect the popup',async()=>{
 let signal;const f=fixture(async(path,options)=>{signal=options.signal;return new Promise(()=>{});}),remote=await f.connect();
 const pending=remote.fetch('/api/v1/phone-backup');await new Promise(r=>setImmediate(r));f.changeSource();await assert.rejects(pending,/source changed|disconnect/i);assert.equal(signal.aborted,true);remote.close();f.bridge.close();
});
test('wrong window, origin and nonce cannot invoke car requests',async()=>{
 const f=fixture(),remote=await f.connect();const message={bvBridge:1,type:'request',nonce:NONCE,id:99,path:'/api/v1/phone-backup',method:'GET'};
 for(const event of [{origin:PUBLIC,source:{},data:message},{origin:'https://evil.example',source:f.popup,data:message},{origin:PUBLIC,source:f.popup,data:{...message,nonce:'2'.repeat(64)}}])f.carWindow.emit('message',event);
 await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,0);remote.close();f.bridge.close();
});

test('the active popup receives a new selection without navigation or interrupting requests',async()=>{
 const f=fixture(),remote=await f.connect(),next='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',seen=[];const off=remote.onSelection(ids=>seen.push(ids));
 const address=f.popup.location.href;await f.bridge.select([next]);await new Promise(r=>setImmediate(r));assert.equal(f.popup.location.href,address);assert.deepEqual(seen,[[next]]);assert.deepEqual(remote.selectedIds,[next]);off();remote.close();f.bridge.close();
});
test('caller cancellation aborts the parent request and does not close a usable bridge',async()=>{
 let signal;const f=fixture(async(path,options)=>{signal=options.signal;return new Promise(()=>{});}),remote=await f.connect(),controller=new AbortController();
 const pending=remote.fetch('/api/v1/phone-backup',{signal:controller.signal});await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,{name:'AbortError'});await new Promise(r=>setImmediate(r));assert.equal(signal.aborted,true);assert.equal(remote.closed,false);assert.equal(f.bridge.inflight.size,0);remote.close();f.bridge.close();
});
test('bounded response cap and concurrency cap reject excess work',async()=>{
 const huge=fixture(async()=>new Response(new Uint8Array(1048577))),peer=await huge.connect();await assert.rejects(peer.fetch('/api/v1/phone-backup'),/too large/);peer.close();huge.bridge.close();
 const f=fixture(async()=>new Promise(()=>{})),remote=await f.connect(),controllers=Array.from({length:4},()=>new AbortController());
 const pending=controllers.map(controller=>remote.fetch('/api/v1/phone-backup',{signal:controller.signal}).catch(e=>e));await new Promise(r=>setImmediate(r));await assert.rejects(remote.fetch('/api/v1/phone-backup'),/concurrent/);controllers.forEach(c=>c.abort());await Promise.all(pending);remote.close();f.bridge.close();
});
test('a short caller timeout cancels parent work rather than leaving an upload request behind',async()=>{
 let signal;const f=fixture(async(path,options)=>{signal=options.signal;return new Promise(()=>{});}),remote=await f.connect();await assert.rejects(remote.fetch('/api/v1/phone-backup',{timeoutMs:5}),/stopped responding/);await new Promise(r=>setImmediate(r));assert.equal(signal.aborted,true);assert.equal(f.bridge.inflight.size,0);remote.close();f.bridge.close();
});
test('only the authenticated completion returns to the original car window without replacing its source',async()=>{const f=fixture(),remote=await f.connect();let focused=0,closed=0;f.carWindow.focus=()=>focused++;f.popup.close=()=>{closed++;f.popup.closed=true;};const event={origin:PUBLIC,source:f.popup,data:{bvBridge:1,type:'complete',nonce:NONCE}};f.carWindow.emit('message',{...event,origin:'https://evil.example'});f.carWindow.emit('message',{...event,data:{...event.data,nonce:'2'.repeat(64)}});assert.equal(closed,0);f.carWindow.emit('message',event);assert.equal(focused,1);assert.equal(closed,1);assert.equal(f.manager.source,f.source);assert.equal(f.carWindow.location.origin,ORIGIN);assert.equal(f.bridge.closed,true);remote.close();});
test('completion after source change cannot close the popup or claim a successful return',async()=>{const f=fixture(),remote=await f.connect();let closed=0;f.popup.close=()=>closed++;f.changeSource();f.carWindow.emit('message',{origin:PUBLIC,source:f.popup,data:{bvBridge:1,type:'complete',nonce:NONCE}});assert.equal(closed,0);remote.close();f.bridge.close();});
