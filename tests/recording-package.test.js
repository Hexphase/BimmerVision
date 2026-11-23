'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const recorderVersion=require('../recorder/files/version.json').version;
const root=path.resolve(__dirname,'..');
function entries(file){const raw=zlib.gunzipSync(fs.readFileSync(file)),files=new Map();for(let at=0;at+512<=raw.length;){const h=raw.subarray(at,at+512),name=h.subarray(0,100).toString().replace(/\0.*$/s,'');if(!name)break;const size=parseInt(h.subarray(124,136).toString().replace(/\0.*$/s,''),8);assert.ok(Number.isSafeInteger(size)&&size>=0);at+=512;files.set(name,raw.subarray(at,at+size));at+=Math.ceil(size/512)*512;}return files;}
test('app and recorder release contain recording and playback without live-preview components or dependencies',()=>{
 const v=require('../package.json').version,rec=entries(path.join(root,'bimmervision-recorder@'+recorderVersion+'.tgz')),app=entries(path.join(root,'bimmervision@'+v+'.tgz')),component=JSON.parse(rec.get('component.json'));
 assert.equal(component.requires['cluster-render'],undefined);assert.equal(require('../idrive/mgu-app.json').requires['bimmervision-recorder'],recorderVersion);
 for(const files of [rec,app])for(const name of files.keys())assert.doesNotMatch(name,/cluster(?:\/|-)|bvcamera-decode|loading-label|takeover-label|intel-mediasdk|mgu-camcluster/,'retired live feature in '+name);
 for(const name of ['files/main.js','files/receiver','files/perception-receiver','files/horn.js','files/diagnostic-log.js','files/mobile-web/exporter.js'])assert.ok(rec.has(name),name);
 assert.ok(app.has('package/src/recording-health.js'));
});
