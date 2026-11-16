/* Direct car transport: same-origin sessions, no hosted source chooser. */
(function(root){
'use strict';
function get(storage,key){try{return storage?.getItem(key)||'';}catch(_){return '';}}
function put(storage,key,value){try{storage?.setItem(key,value);}catch(_){}}
class CarSource {
 constructor(options={}){
  this.kind='car';this.name='Connected iDrive';this.readOnly=false;
  this.fetcher=options.fetcher||root.fetch.bind(root);this.session=options.sessionStorage||root.sessionStorage;this.local=options.localStorage||root.localStorage;
  this.location=options.location||root.location;this.history=options.history||root.history;this.crypto=options.crypto||root.crypto;
  this.token=get(this.session,'bimmervision_bearer');this.csrf=get(this.session,'bimmervision_csrf');
 }
 static async connect(options){const source=new CarSource(options);await source.ensureSession();return source;}
 async fetch(path,options={}){
  if(typeof path!=='string'||!/^\/api\/v1\//.test(path)||/[\\\r\n#]/.test(path)||/%(?:2e|2f|5c)/i.test(path)||path.split(/[/?]/).includes('..'))throw Error('Use a relative same-origin car API path.');
  const headers=new Headers(options.headers||{});
  if(this.token&&!headers.has('Authorization'))headers.set('Authorization','Bearer '+this.token);
  if(!['GET','HEAD'].includes((options.method||'GET').toUpperCase())&&this.csrf)headers.set('X-BV-CSRF',this.csrf);
  const init={...options,headers,credentials:'include',redirect:'error'};delete init.timeoutMs;
  return this.fetcher(path,init);
 }
 async ensureSession(){
  const params=new URLSearchParams(this.location.search),code=params.get('code');
  const probe=await this.fetch('/api/v1/recordings');
  await probe.body?.cancel();
  if(!probe.ok){
   if(probe.status!==401&&probe.status!==403)throw Error('The car could not open its recordings. Retry the connection.');
   if(!code||!/^\d{8}$/.test(code))throw Error('Open Connect Phone in iDrive and use its current address and pairing code.');
   let clientId=get(this.local,'bimmervision_client_id');
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clientId)){
    const bytes=this.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');clientId=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');put(this.local,'bimmervision_client_id',clientId);
   }
   const response=await this.fetch('/api/v1/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,clientId})});
   const info=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(info.error||'Pairing failed. Reopen Connect Phone in iDrive.');
   if(typeof info.token!=='string'||!info.token||typeof info.csrf!=='string'||!info.csrf)throw Error('Invalid pairing response. Reopen Connect Phone in iDrive.');
   this.token=info.token;this.csrf=info.csrf;put(this.session,'bimmervision_bearer',this.token);put(this.session,'bimmervision_csrf',this.csrf);
  }
  if(code){params.delete('code');const query=params.toString();this.history.replaceState({},'',this.location.pathname+(query?'?'+query:'')+(this.location.hash||''));}
 }
 close(){}
}
if(typeof module!=='undefined'&&module.exports)module.exports={CarSource};
else root.addEventListener('DOMContentLoaded',()=>{
 const status=document.getElementById('carConnectionStatus'),retry=document.getElementById('carConnectionRetry');let pending=false;
 root.BVAppVersion={setConnected(version){const node=document.getElementById('footerAppVersion');if(node)node.textContent=typeof version==='string'&&/^\d+\.\d+\.\d+$/.test(version)?'BimmerVision v'+version:'BimmerVision';}};
 async function connect(){if(pending)return;pending=true;retry.hidden=true;status.firstChild.textContent='Connecting to your car… ';
  try{const source=await CarSource.connect();root.BVSourceManager.setSource(source);status.hidden=true;}
  catch(error){status.firstChild.textContent=error.message+' ';retry.hidden=false;}
  finally{pending=false;}
 }
 retry.addEventListener('click',connect);connect();
});
})(typeof globalThis!=='undefined'?globalThis:this);
