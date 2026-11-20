/* The paired car page carries bounded local API traffic for one public upload popup.
   Car authentication stays inside the existing source; Google authentication stays in the popup. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.BVCarBackupBridge=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const PUBLIC='https://bimmervision.app',MAX=1048576,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function selection(ids){if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!UUID.test(id))||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw Error('Select 1 to 1000 distinct recordings.');return ids.map(id=>id.toLowerCase());}
function privateOrigin(value){const url=new URL(value),parts=url.hostname.split('.');if(url.origin!==value||!['http:','https:'].includes(url.protocol)||url.username||url.password||parts.length!==4||parts.some(p=>! /^(0|[1-9]\d{0,2})$/.test(p)||Number(p)>255))throw Error('Use the private car connection.');const [a,b]=parts.map(Number);if(!(a===10||a===172&&b>=16&&b<=31||a===192&&b===168||a===169&&b===254))throw Error('Use the private car connection.');return url.origin;}
function validateRequest(value){
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['path','method','body'].includes(k)))throw Error('Invalid phone bridge request.');
 const path=value.path,method=value.method||'GET';
 const get=typeof path==='string'&&/^\/api\/v1\/(phone-backup|remote-backup|viewer-heartbeat|capabilities|version)$/.test(path);
 const post=typeof path==='string'&&/^\/api\/v1\/(remote-backup\/queue|phone-backup\/(claim|enqueue|[a-f0-9]{32}\/(read|register|heartbeat|release)))$/.test(path);
 if(!(method==='GET'&&get||method==='POST'&&post))throw Error('This car API is not available through phone backup.');
 if(method==='GET'){if(value.body!==undefined)throw Error('Unexpected request body.');return {path,options:{method},timeoutMs:path==='/api/v1/remote-backup'?120000:15000};}
 const limit=/\/register$/.test(path)?300*1024:/\/(queue|enqueue)$/.test(path)?60*1024:2048;
 if(typeof value.body!=='string'||new TextEncoder().encode(value.body).byteLength>limit)throw Error('Phone backup request is too large.');
 let body;try{body=JSON.parse(value.body);}catch{throw Error('Use a JSON backup request.');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Use a JSON backup request.');
 if(/\/read$/.test(path)&&(!Number.isSafeInteger(body.index)||body.index<0||!Number.isSafeInteger(body.offset)||body.offset<0||!Number.isSafeInteger(body.length)||body.length<1||body.length>MAX||!Number.isSafeInteger(body.offset+body.length)))throw Error('Invalid bounded recording read.');
 return {path,options:{method,headers:{'Content-Type':'application/json'},body:value.body},timeoutMs:/\/claim$/.test(path)?600000:/\/(queue|enqueue|register)$/.test(path)?120000:/\/read$/.test(path)?30000:15000};
}
function wait(promise,signal){if(signal.aborted)return Promise.reject(signal.reason||new DOMException('Cancelled','AbortError'));return new Promise((resolve,reject)=>{const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason||new DOMException('Cancelled','AbortError'));};signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});}
async function bytes(response,signal){
 const expected=Number(response.headers.get('Content-Length'))||0;if(expected>MAX){await response.body?.cancel();throw Error('Phone backup response is too large.');}
 if(!response.body)return new ArrayBuffer(0);
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const part=await wait(reader.read(),signal);if(part.done)break;size+=part.value.byteLength;if(size>MAX)throw Error('Phone backup response is too large.');chunks.push(part.value);}if(expected&&expected!==size)throw Error('Incomplete phone backup response.');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out.buffer;
}
class CarBackupBridge{
 constructor({window=root,manager=window.BVSourceManager,popup,ids,nonce,handshakeTimeoutMs=15000,idleTimeoutMs=300000}={}){
  this.window=window;this.manager=manager;this.popup=popup;this.ids=selection(ids);this.origin=privateOrigin(window.location.origin);this.source=manager?.source;this.generation=manager?.generation;
  if(this.source?.kind!=='car'||!popup||popup.closed)throw Error('Keep the paired car page open and allow the backup popup.');
  if(nonce===undefined){const values=new Uint8Array(32);window.crypto.getRandomValues(values);nonce=Array.from(values,b=>b.toString(16).padStart(2,'0')).join('');}
  if(typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce))throw Error('Invalid phone backup connection.');
  this.nonce=nonce;this.handshakeTimeoutMs=handshakeTimeoutMs;this.idleTimeoutMs=idleTimeoutMs;this.inflight=new Map();this.lastId=0;this.closed=false;this.connected=false;this.touched=Date.now();
 }
 validSource(){return !this.closed&&this.manager.source===this.source&&this.manager.generation===this.generation;}
 send(type,fields={},transfer){if(this.closed)return;this.popup.postMessage({bvBridge:1,type,nonce:this.nonce,...fields},PUBLIC,transfer||[]);}
 open(){
  if(this.ready)return this.ready;
  this.ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
  this.listener=event=>this.receive(event);this.unload=()=>this.close('The car page was closed.');
  this.window.addEventListener('message',this.listener);this.window.addEventListener('pagehide',this.unload);
  this.unsubscribe=this.manager.subscribe(()=>{if(!this.validSource())this.close('Recording source changed. Reopen phone backup.');});
  this.handshakeTimer=setTimeout(()=>this.close('Phone backup did not connect. Check phone internet and reopen backup.'),this.handshakeTimeoutMs);
  this.monitor=setInterval(()=>{if(this.popup.closed)this.close('The phone backup popup was closed.');else if(!this.validSource())this.close('Recording source changed. Reopen phone backup.');else if(Date.now()-this.touched>this.idleTimeoutMs)this.close('Phone backup connection expired. Reopen backup.');},1000);
  const target=new URL(PUBLIC+'/phone-backup.html');target.search='v=77';target.hash=new URLSearchParams({origin:this.origin,nonce:this.nonce}).toString();
  try{this.popup.location.href=target.href;}catch{this.close('Could not open phone backup. Allow the backup popup and retry.');}
  return this.ready;
 }
 select(ids){this.ids=selection(ids);if(!this.validSource())throw Error('Recording source changed. Reopen phone backup.');this.touched=Date.now();if(this.connected)this.send('selection',{selectedIds:this.ids});return this.ready;}
 receive(event){
  const message=event.data;if(this.closed||event.source!==this.popup||event.origin!==PUBLIC||!message||message.bvBridge!==1||message.nonce!==this.nonce)return;
  if(!this.validSource()){this.close('Recording source changed. Reopen phone backup.');return;}
  this.touched=Date.now();
  if(message.type==='hello'){this.send('ready',{selectedIds:this.ids});if(!this.connected){this.connected=true;clearTimeout(this.handshakeTimer);this.resolve(this);}return;}
  if(!this.connected)return;
  if(message.type==='complete'){
   // A completion can affect only the exact popup and paired source accepted
   // above. Keep the original car URL, source and authentication untouched.
   try{this.window.focus();}catch{}
   try{this.popup.close();}catch{}
   this.close('Phone upload finished. Returned to the car player.');return;
  }
  if(message.type==='close'){this.close('Phone backup disconnected.');return;}
  if(!Number.isSafeInteger(message.id)||message.id<1)return;
  if(message.type==='cancel'){const active=this.inflight.get(message.id);if(active)active.abort(new DOMException('Cancelled','AbortError'));return;}
  if(message.type!=='request'||message.id<=this.lastId)return;
  this.lastId=message.id;
  if(this.inflight.size>=4){this.send('response',{id:message.id,error:'Too many concurrent phone backup requests.'});return;}
  let request;try{request=validateRequest({path:message.path,method:message.method,...(message.body===undefined?{}:{body:message.body})});}catch(error){this.send('response',{id:message.id,error:error.message});return;}
  this.rpc(message.id,request);
 }
 async rpc(id,request){
  const controller=new AbortController();this.inflight.set(id,controller);const timer=setTimeout(()=>controller.abort(new Error('Phone backup request timed out.')),request.timeoutMs);
  try{
   const response=await wait(this.source.fetch(request.path,{...request.options,signal:controller.signal}),controller.signal);
   if(!this.validSource())throw Error('Recording source changed. Reopen phone backup.');
   const body=await wait(bytes(response,controller.signal),controller.signal);
   if(!this.validSource()||controller.signal.aborted)throw Error('Phone backup disconnected.');
   const headers={'Content-Length':String(body.byteLength)},type=response.headers.get('Content-Type');if(type)headers['Content-Type']=type;
   this.send('response',{id,status:response.status,headers,body},[body]);
  }catch(error){if(!controller.signal.aborted)this.send('response',{id,error:'Phone backup request failed. '+(error.message||'Retry the connection.')});else if(controller.signal.reason?.name!=='AbortError')this.send('response',{id,error:controller.signal.reason?.message||'Phone backup request timed out.'});}
  finally{clearTimeout(timer);this.inflight.delete(id);}
 }
 close(reason='Phone backup disconnected.'){
  if(this.closed)return;try{this.send('disconnected',{error:reason});}catch{}
  this.closed=true;clearTimeout(this.handshakeTimer);clearInterval(this.monitor);this.window.removeEventListener('message',this.listener);this.window.removeEventListener('pagehide',this.unload);this.unsubscribe?.();
  for(const controller of this.inflight.values())controller.abort(new DOMException(reason,'AbortError'));this.inflight.clear();if(!this.connected)this.reject?.(new Error(reason));
 }
}
let active=null;
return {CarBackupBridge,validateRequest,selection,privateOrigin,isActive(popup){return !!active&&!active.closed&&active.popup===popup&&active.validSource();},get activePopup(){return active&&!active.closed?active.popup:null;},open(ids,popup){
 if(active&&!active.closed&&active.popup===popup&&active.validSource())return active.select(ids);
 active?.close('A new phone backup connection was opened.');active=new CarBackupBridge({popup,ids});return active.open();
}};
});
