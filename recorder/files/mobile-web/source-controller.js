/* Car-hosted player: open the authenticated local library first. */
document.addEventListener('DOMContentLoaded',()=>{
 const account=window.BVGoogleDriveAccount;
 const manager=window.BVSourceManager,screen=document.getElementById('sourceScreen'),shell=document.querySelector('.app-shell');
 const error=document.getElementById('sourceError'),progress=document.getElementById('sourceProgress'),cancel=document.getElementById('cancelSourceWork'),back=document.getElementById('returnToRecordingsBtn');
 const code=document.getElementById('carCode'),folder=document.getElementById('usbFolderInput');
 const usbDialog=document.getElementById('usbInstructions'),usbOpen=document.getElementById('openUsbBtn');
 document.getElementById('usbSecurePlayback').hidden=typeof VideoDecoder!=='undefined';
 const usbBackup=document.getElementById('usbBackupHandoff');
 function openUsbBackup(){if(!usbBackup.open)usbBackup.showModal();return true;}
 window.BVGoogleDriveBackupUI={open:openUsbBackup,openDrive:openUsbBackup,showActive:()=>false};
 const closeUsb=()=>{if(usbDialog?.open)usbDialog.close();};
 let work=null,epoch=0;
 const connectButton=document.getElementById('connectCarBtn');
 function message(text){progress.textContent=text||'';}
 function failure(reason){error.textContent=reason?.message||String(reason);error.hidden=false;}
 function stopWork(){epoch++;work?.abort();work=null;connectButton.disabled=false;cancel.hidden=true;message('');}
 function startWork(text){stopWork();work=new AbortController();connectButton.disabled=true;error.hidden=true;cancel.hidden=false;message(text);return {token:epoch,signal:work.signal};}
 function show(){closeUsb();stopWork();window.player?.pause();shell.hidden=true;shell.inert=true;screen.hidden=false;back.hidden=!manager.source;document.getElementById('openUsbBtn').focus();}
 function hide(){closeUsb();stopWork();screen.hidden=true;shell.hidden=false;shell.inert=false;const button=document.getElementById('changeSourceBtn'),menu=button.closest?.('details');(button.hidden?document.getElementById('recordingsPageTitle'):menu&&!menu.open?menu.querySelector('summary'):button).focus();}
 function updateSourceAccess(source){
  document.body.dataset.usbSource=String(source.kind==='usb');
  document.body.dataset.sourceReadonly=String(source.readOnly===true);
  document.body.dataset.sourceCanDelete=String(source.kind==='car'&&source.canDelete!==false);
  const notice=document.getElementById('sourceAccessNotice');notice.hidden=source.kind!=='usb';
  if(source.kind==='usb')notice.textContent=source.canLock?'USB lock changes are saved to the drive after you allow write access. Video files stay unchanged.':'USB recordings are open for viewing. Choose Lock or Unlock to allow changes to recording metadata.';
 }
 function chosen(source){
  if(source.kind==='usb' && source.recordingCount===0){
   source.close();stopWork();
   failure(source.warnings[0] || 'No complete recordings found. Choose the BimmerVision folder on your USB drive or a recording folder containing manifest.json and capture.bvr.');
   return;
  }
  work=null;manager.setSource(source);updateSourceAccess(source);closeUsb();if(window.BVDashboard?.sourceSelected(source)){back.hidden=false;stopWork();}else hide();source.indexing?.then(()=>{if(manager.source===source)window.dispatchEvent(new Event('bimmervision:library-updated'));}).catch(()=>{});}

 document.getElementById('connectGoogleDriveBtn').addEventListener('click',()=>{
  window.open('https://bimmervision.app/#googleDriveConnection','_blank','noopener,noreferrer');
 });
 document.getElementById('changeSourceBtn').addEventListener('click',show);
 back.addEventListener('click',hide);
 cancel.addEventListener('click',stopWork);
 folder.addEventListener('click',()=>{folder.value='';});
 usbOpen.addEventListener('click',()=>{
  stopWork();document.getElementById('usbPickerStatus').textContent='';
  usbDialog.showModal();
 });
 document.getElementById('closeUsbInstructionsBtn').addEventListener('click',closeUsb);
 usbDialog.addEventListener('click',event=>{const r=usbDialog.getBoundingClientRect();if(event.target===usbDialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))closeUsb();});
 folder.addEventListener('change',async()=>{
  if(!folder.files.length)return;closeUsb();const job=startWork('Opening USB recordings…');
  try{const source=await BVLocalSource.fromFiles(folder.files,{signal:job.signal});if(job.token!==epoch){source.close();return;}chosen(source);}
  catch(e){if(job.token===epoch&&e.name!=='AbortError'){stopWork();failure(e);}}
 });
 async function openCar(){
  const job=startWork('Opening car recordings…');
  try {
   const source=await BVCarSource.connect({pairingCode:code.value.trim(),signal:job.signal});
   if(job.token!==epoch)return;
   code.value='';
   work=null;
   manager.setSource(source);
   document.getElementById('openLibraryCard').click();
  } catch(e){
   if(job.token!==epoch)return;
   stopWork();
   window.BVDashboard.showCarPairing();
   failure(e);
  }
 }
 document.getElementById('openCarRecordings').addEventListener('click',openCar);
 document.getElementById('carConnectForm').addEventListener('submit',event=>{event.preventDefault();openCar();});
 window.addEventListener('pagehide',event=>{stopWork();if(!event.persisted){manager.source?.close();account.clear();}});
 manager.subscribe(updateSourceAccess);
 openCar();
});
