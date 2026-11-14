'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const Transfer = require('../recorder/files/transfer').Transfer;
const PAGES = 'https://hexphase.github.io';
const SITE = 'https://bimmervision.app';
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function fixture(t) {
  const transfer = new Transfer({host:'127.0.0.1', nowMs:()=>0, library:{list:async()=>[]}});
  transfer.current = 'test'; transfer.lastBeat = 0; transfer.code = '12345678';
  const server = http.createServer((req,res)=>transfer.handle(req,res,0).catch(error=>transfer.json(res,error.statusCode||500,{error:error.message})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  transfer.boundHttpPort=server.address().port;
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  function request(method,route,headers,body) {
    return new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port:server.address().port,path:route,method,headers:headers||{}},res=>{
        const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{
          const raw=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,body:raw?JSON.parse(raw):null});
        });
      });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
    });
  }
  return {transfer, request, pair:origin=>request('POST','/api/v1/pair',{Origin:origin,'Content-Type':'application/json'},{code:'12345678',clientId:CLIENT})};
}
test('approved hosted preflight permits bearer API methods and optional private network access',async t=>{
  const f=await fixture(t);
  for (const origin of [PAGES,SITE]) {
    const result=await f.request('OPTIONS','/api/v1/pair',{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization, content-type, range','Access-Control-Request-Private-Network':'true'});
    assert.equal(result.status,204);assert.equal(result.headers['access-control-allow-origin'],origin);
    assert.match(result.headers.vary,/Origin/);assert.match(result.headers['access-control-allow-methods'],/DELETE/);
    assert.match(result.headers['access-control-allow-headers'],/Authorization/i);
    assert.match(result.headers['access-control-allow-headers'],/Range/i);
    assert.equal(result.headers['access-control-allow-private-network'],'true');
    assert.equal(result.headers['access-control-allow-credentials'],undefined);
  }
  assert.equal(f.transfer.session,null);assert.equal(f.transfer.claimed,false);
  const normal=await f.request('OPTIONS','/api/v1/pair',{Origin:PAGES,'Access-Control-Request-Method':'POST'});
  assert.equal(normal.headers['access-control-allow-private-network'],undefined);
});
test('hosted pair is single use, cookie free and bearer bound to the exact origin',async t=>{
  const f=await fixture(t),paired=await f.pair(PAGES);
  assert.equal(paired.status,200);assert.equal(paired.headers['set-cookie'],undefined);
  assert.equal(paired.headers['access-control-allow-origin'],PAGES);
  const headers={Origin:PAGES,Authorization:'Bearer '+paired.body.token};
  const cap=await f.request('GET','/api/v1/capabilities',headers);
  assert.equal(cap.status,200);assert.equal(cap.body.hostedViewer,true);assert.equal(cap.body.apiVersion,1);
  const list=await f.request('GET','/api/v1/recordings',headers);
  assert.equal(list.status,200);assert.match(list.headers['access-control-expose-headers'],/Content-Range/);
  for (const origin of [undefined,SITE,'https://evil.example']) {
    const h={Authorization:headers.Authorization};if(origin)h.Origin=origin;
    assert.equal((await f.request('GET','/api/v1/recordings',h)).status,403);
  }
  const cookie=await f.request('GET','/api/v1/recordings',{Origin:PAGES,Cookie:'bv_session='+paired.body.token});
  assert.equal(cookie.status,401);
  assert.equal((await f.pair(PAGES)).status,409);
  const logout=await f.request('POST','/api/v1/logout',headers);
  assert.equal(logout.status,200);assert.equal(logout.headers['set-cookie'],undefined);
  assert.equal((await f.request('GET','/api/v1/recordings',headers)).status,401);
});
test('unapproved origins cannot preflight, pair or consume attempts even with valid code',async t=>{
  const f=await fixture(t);
  for (const origin of ['https://evil.example','https://hexphase.github.io.evil.example','http://hexphase.github.io','null','https://Hexphase.github.io']) {
    for (const method of ['OPTIONS','POST']) {
      const result=method==='POST'?await f.pair(origin):await f.request(method,'/api/v1/pair',{Origin:origin,'Access-Control-Request-Method':'POST'});
      assert.equal(result.status,403);assert.equal(result.headers['access-control-allow-origin'],undefined);
    }
  }
  assert.equal(f.transfer.attempts.length,0);assert.equal(Object.keys(f.transfer.addressAttempts).length,0);
  assert.equal(f.transfer.session,null);assert.equal(f.transfer.claimed,false);
  assert.equal((await f.pair(PAGES)).status,200);
});
test('hosted preflight rejects unapproved headers and methods',async t=>{
  const f=await fixture(t);
  for (const headers of [{'Access-Control-Request-Method':'PUT'},{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-unapproved'}]) {
    assert.equal((await f.request('OPTIONS','/api/v1/pair',Object.assign({Origin:PAGES},headers))).status,403);
  }
});
test('same-origin cookie pairing and CSRF protection remain intact',async t=>{
  const f=await fixture(t),origin='http://127.0.0.1:'+f.transfer.boundHttpPort;
  const pair=await f.pair(origin);assert.equal(pair.status,200);assert.ok(pair.headers['set-cookie']);
  const headers={Origin:origin,Cookie:'bv_session='+pair.body.token};
  assert.equal((await f.request('GET','/api/v1/recordings',headers)).status,200);
  assert.equal((await f.request('POST','/api/v1/logout',headers)).status,403);
  headers['X-BV-CSRF']=pair.body.csrf;
  assert.equal((await f.request('POST','/api/v1/logout',headers)).status,200);
});
test('host validation and closed connection screen still reject hosted requests',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('OPTIONS','/api/v1/pair',{Origin:PAGES,Host:'evil.example'})).status,403);
  f.transfer.current=null;
  assert.equal((await f.pair(PAGES)).status,403);
});
