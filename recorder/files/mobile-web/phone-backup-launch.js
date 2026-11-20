/* Starts the hosted Google flow without sharing Google credentials with the car page. */
(function(root){
'use strict';
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function buildLink(origin,code,clipId,driveClipId){
 const car=new URL(origin),parts=car.hostname.split('.').map(Number);
 if(!['http:','https:'].includes(car.protocol)||car.username||car.password||car.pathname!=='/'||car.search||car.hash||parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255)||!(parts[0]===10||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&parts[1]===168||parts[0]===169&&parts[1]===254)||!/^\d{8}$/.test(code))throw Error('Open the current private car Connect Phone address before starting phone backup.');
 if(clipId!==undefined&&!validId(clipId))throw Error('Choose a valid recording before starting phone backup.');
 if(driveClipId!==undefined&&!validId(driveClipId))throw Error('Choose a valid drive before starting phone backup.');
 if(clipId!==undefined&&driveClipId!==undefined)throw Error('Choose either a recording or an entire drive.');
 const params=new URLSearchParams({car:car.origin,code,backup:'1'});if(clipId!==undefined)params.set('clip',clipId);if(driveClipId!==undefined)params.set('drive',driveClipId);
 const url=new URL('https://bimmervision.app/');url.hash=params.toString();return url.href;
}
if(typeof module==='object'&&module.exports)module.exports={buildLink};
else root.addEventListener('DOMContentLoaded',()=>{
 const settingsButton=document.getElementById('phoneBackupOpen'),status=document.getElementById('phoneBackupLaunchStatus');
 let currentPopup=null,connected=false;
 function fail(error){const message=error.message||'Could not open phone backup.';if(status)status.textContent=message;else root.alert(message);}
 function validate(ids){if(!Array.isArray(ids)||!ids.length||ids.length>1000||!ids.every(validId)||new Set(ids.map(id=>id.toLowerCase())).size!==ids.length)throw Error('Choose a valid drive or distinct recordings before starting backup.');return ids.slice();}
 function preparePopup(){
  if(currentPopup&&!currentPopup.closed){currentPopup.focus?.();return currentPopup;}
  const popup=root.open('about:blank','BimmerVisionRemoteBackup','popup,width=520,height=780');
  if(!popup)throw Error('Allow pop-ups for this car page, then press Back up selected recordings again.');
  currentPopup=popup;connected=false;
  try{popup.document.title='Remote Backup';popup.document.body.textContent='Preparing your secure Remote Backup window…';}catch(_){}
  return popup;
 }
 async function openQueue(ids,popup){
  try{
   const chosen=validate(ids);popup=popup||preparePopup();
   const manager=root.BVSourceManager,source=manager.source,generation=manager.generation;await manager.ready;
   if(source!==manager.source||generation!==manager.generation||source?.kind!=='car')throw Error('Recording source changed. Connect to the car and select the recording again.');
   if(!root.BVCarBackupBridge)throw Error('Reload the car page before starting Remote Backup.');
   if(status)status.textContent='Connecting your secure phone upload window…';
   await root.BVCarBackupBridge.open(chosen,popup);connected=true;
   if(status)status.textContent='Remote Backup is open. Keep this car tab open and use the upload window.';
   popup.focus?.();return true;
  }catch(error){if(popup&&!connected){try{popup.close();}catch(_){}}fail(error);return false;}
 }

 async function openDirect(ids,popup){
  try{
   const chosen=validate(ids);popup=popup||preparePopup();
   const manager=root.BVSourceManager,source=manager.source,generation=manager.generation;
   const check=()=>{if(manager.source!==source||manager.generation!==generation||source?.kind!=='car')throw Error('Recording source changed. Select the recording again.');};
   await manager.ready;check();
   const statusResponse=await source.fetch('/api/v1/remote-backup');const value=await statusResponse.json();check();
   if(!statusResponse.ok)throw Error(value.error||'Could not prepare this recording for backup.');
   if(typeof value.sourceToken!=='string'||!value.sourceToken)throw Error('Reload the car page before starting Remote Backup.');
   // The backend validates complete recordings and USB membership before saving
   // this exact selection. Phone upload still waits for its separate consent.
   const response=await source.fetch('/api/v1/remote-backup/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',clipIds:chosen,sourceToken:value.sourceToken})});
   const queued=await response.json();check();if(!response.ok)throw Error(queued.error||'Could not save the selected backup queue.');
   return await openQueue(chosen,popup);
  }catch(error){if(popup&&!connected){try{popup.close();}catch(_){}}fail(error);return false;}
 }
 root.BVPhoneBackupLaunch={preparePopup,openQueue,openDirect};
 if(settingsButton)settingsButton.addEventListener('click',()=>root.BVRemoteBackupPage?.open([],{add:true}));
 document.addEventListener('click',async event=>{
  const drive=event.target.closest?.('[data-backup-drive]'),button=drive||event.target.closest?.('[data-backup-recording]');if(!button)return;
  event.preventDefault();event.stopPropagation();button.disabled=true;
  try{const ids=validate(drive?JSON.parse(button.dataset.backupDrive):[button.dataset.backupRecording]);const popup=preparePopup();await openDirect(ids,popup);}
  catch(error){fail(error);}finally{button.disabled=false;}
 });
});
})(typeof globalThis!=='undefined'?globalThis:this);
