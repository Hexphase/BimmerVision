'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const browser=require('../recorder/files/browser');
const root=path.resolve(__dirname,'../recorder/files/mobile-web');
const memory=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};};
function options(fetcher,search='?code=12345678'){
 const session=memory(),local=memory(),urls=[];
 return {fetcher,sessionStorage:session,localStorage:local,location:{search,pathname:'/',hash:''},history:{replaceState:(_a,_b,url)=>urls.push(url)},crypto:{getRandomValues:array=>array.fill(7)},urls};
}
test('car opens the advanced recordings UI without a hosted homepage or source chooser',()=>{
 const html=browser.asset('/').body.toString();
 assert.match(html,/id="drivingViewPanel"/);assert.match(html,/recording-navigation\.js/);
 assert.doesNotMatch(html,/id="(?:sourceScreen|usbFolderInput|carConnectForm|changeSourceBtn)"|homepage\.css|source-controller\.js|app-version\.js/);
 assert.doesNotMatch(html,/class="app-shell" hidden/);
});
test('all car HTML resources and driving-view module dependencies resolve with usable MIME',()=>{
 const html=browser.asset('/').body.toString(),paths=[...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>m[1]).filter(p=>!/^https?:/.test(p));
 paths.push('driving-scene.js','standard-fleet.js','road-estimation.js','vendor/three/three.module.min.js','vendor/three/RoomEnvironment.js','assets/vehicles/sedan.bin.gz');
 for(const ref of paths){const asset=browser.asset('/'+ref.split('?')[0]);assert(asset,ref);if(ref.split('?')[0].endsWith('.js'))assert.match(asset.type,/javascript/,ref);}
 const model=browser.asset('/assets/vehicles/sedan.bin.gz').body;assert.equal(model.readUInt16LE(0),0x8b1f);
});
test('car adapter probes cookie/bearer sessions before claiming a pairing code',async()=>{
 const {CarSource}=require(path.join(root,'car-source'));
 const calls=[],o=options(async(route,init)=>{calls.push({route,init});return new Response('[]');});o.sessionStorage.setItem('bimmervision_bearer','saved');
 const source=await CarSource.connect(o);assert.equal(source.kind,'car');assert.equal(source.readOnly,false);assert.equal(calls.length,1);assert.equal(calls[0].route,'/api/v1/recordings');assert.equal(calls[0].init.headers.get('Authorization'),'Bearer saved');assert.equal(calls[0].init.credentials,'include');assert.equal(o.urls.at(-1),'/');
});
test('car adapter pairs on HTTP without randomUUID and retains cookie mutation CSRF fallback',async()=>{
 const {CarSource}=require(path.join(root,'car-source'));const calls=[];
 const o=options(async(route,init)=>{calls.push({route,init});if(route==='/api/v1/pair')return Response.json({token:'paired-token',csrf:'paired-csrf'});return new Response('{}',{status:calls.length===1?401:200});});
 const source=await CarSource.connect(o),pair=calls.find(c=>c.route==='/api/v1/pair');assert.match(JSON.parse(pair.init.body).clientId,/^[a-f0-9-]{36}$/);assert.equal(JSON.parse(pair.init.body).code,'12345678');
 assert.equal(o.sessionStorage.getItem('bimmervision_csrf'),'paired-csrf');
 await source.fetch('/api/v1/recordings/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/lock',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(calls.at(-1).init.headers.get('Authorization'),'Bearer paired-token');assert.equal(calls.at(-1).init.headers.get('X-BV-CSRF'),'paired-csrf');
 o.sessionStorage.setItem('bimmervision_bearer','');const cookieOptions={...o,location:{...o.location,search:''}};const cookieSource=await CarSource.connect(cookieOptions);await cookieSource.fetch('/api/v1/recordings/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{method:'DELETE'});assert.equal(calls.at(-1).init.headers.get('Authorization'),null);assert.equal(calls.at(-1).init.headers.get('X-BV-CSRF'),'paired-csrf');
 await assert.rejects(cookieSource.fetch('https://example.com/api/v1/status'),/relative|same.origin/i);
});
test('rejected pairing preserves the code and exposes the car error',async()=>{
 const {CarSource}=require(path.join(root,'car-source'));const o=options(async route=>route.endsWith('/pair')?Response.json({error:'Code expired'},{status:401}):new Response('{}',{status:401}));
 await assert.rejects(CarSource.connect(o),/Code expired/);assert.deepEqual(o.urls,[]);
});
