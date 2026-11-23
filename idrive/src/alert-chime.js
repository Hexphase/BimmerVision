'use strict';
// ID7 front OAP overlay audio route. Leave entertainment volume and routing to iDrive.
var chime='/usr/share/pal/sounds/bmw/kling.wav';
function delay(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
function boost(wav){
 if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw Error('Unknown chime format');
 var pcm=false;
 for(var i=12;i+8<=wav.length;){
   var type=wav.toString('ascii',i,i+4),size=wav.readUInt32LE(i+4),start=i+8,end=start+size;
   if(end>wav.length)break;
   if(type==='fmt ' && size>=16)pcm=wav.readUInt16LE(start)===1 && wav.readUInt16LE(start+14)===16;
   if(type==='data' && pcm && size%2===0){
     var peak=1;
     for(var j=start;j<end;j+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(j)));
     var gain=Math.min(Math.pow(10,1.5/20),32767/peak);
     for(var k=start;k<end;k+=2)wav.writeInt16LE(Math.round(wav.readInt16LE(k)*gain),k);
     return wav;
   }
   i=end+(size%2);
 }
 throw Error('Unsupported chime samples');
}
async function play(route,player,wait,file){
 var result=await route.connect({sourceID:1048,sinkID:1024});
 if(!result||result.amError!=='E_OK'||!Number.isInteger(result.mainConnectionID))
   throw Error('Notification audio route unavailable');
 try{
   await wait(250);
   var playback=await player.playFile({path:file||chime,languageCode:7695972});
   if(!playback||playback.EntError!=='OK')throw Error('Notification sound unavailable');
   await wait(1400);
 }finally{await route.disconnect({mainConnectionID:result.mainConnectionID});}
}
async function notify(app){
 var build=require('oap-sdk').someipBuilders.buildAndInitTypedProxy,route,player;
 try{
   route=await build('org.genivi.am.commandinterface.CommandControl','1');
   player=await build('de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer','OapGenericOverlay');
   var fs=require('fs'),path=require('path'),file,created=false,ready=false;
   try{
     var dir=app.getSharedFolder('mediaFolder');
     try{fs.mkdirSync(dir,493);}catch(e){if(e.code!=='EEXIST')throw e;}
     var samples=boost(fs.readFileSync(chime));
     file=path.join(dir,'bv-alert-'+require('crypto').randomBytes(8).toString('hex')+'.wav');
     var fd=fs.openSync(file,'wx',420);created=true;
     try{fs.writeFileSync(fd,samples);fs.fchmodSync(fd,420);ready=true;}finally{fs.closeSync(fd);}
   }catch(e){console.error('BimmerVision: using original chime');}
   try{await play(route,player,delay,ready&&file);}finally{if(created)try{fs.unlinkSync(file);}catch(ignore){}}

 }finally{
   await Promise.all([route,player].filter(Boolean).map(function(proxy){return proxy.shutdown();}));
 }
}
module.exports={boost:boost,play:play,notify:notify};
