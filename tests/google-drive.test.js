"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { GoogleDrive } = require("../recorder/files/google-drive");
function result(status, value, headers = {}) {
  return { status, headers, body: Buffer.from(JSON.stringify(value)) };
}
test("Google device auth obeys interval and does not replace an account on denial", async () => {
  let now = 0,
    calls = 0;
  const old = {
    accessToken: "old",
    refreshToken: "old-refresh",
    expiresAt: 999999,
  };
  const drive = new GoogleDrive({
    client: { client_id: "client", client_secret: "client-secret" },
    account: old,
    now: () => now,
    transport: {
      request: async (o) => {
        calls++;
        return o.url.endsWith("/device/code")
          ? result(200, {
              verification_url: "https://www.google.com/device",
              user_code: "ABC-123",
              device_code: "private",
              expires_in: 1800,
              interval: 5,
            })
          : result(400, { error: "access_denied" });
      },
    },
  });
  assert.equal((await drive.beginSetup()).userCode, "ABC-123");
  await drive.pollSetup();
  assert.equal(calls, 1);
  now = 5000;
  await assert.rejects(drive.pollSetup(), /denied/);
  assert.equal(drive.account.accessToken, "old");
});
test("Drive resumes from Google-confirmed byte offset and identifies storage-full errors", async () => {
  let reply = result(308, {}, { range: "bytes=0-262143" });
  const drive = new GoogleDrive({
    account: { accessToken: "token", expiresAt: 9999999999999 },
    transport: { request: async () => reply },
  });
  assert.deepEqual(
    await drive.queryUpload(
      "https://www.googleapis.com/upload/drive/v3/files?upload_id=x",
      524288,
    ),
    { offset: 262144, complete: false },
  );
  reply = result(403, {
    error: { errors: [{ reason: "storageQuotaExceeded" }] },
  });
  await assert.rejects(drive.about(), (e) => e.code === "storage-full");
  reply = result(429, { error: { errors: [{ reason: "rateLimitExceeded" }] } });
  await assert.rejects(drive.about(), (e) => e.code === "rate-limit");
});
test("successful consent persists new credentials before switching and refuses incomplete grants", async () => {
  let now = 0,
    fail = true;
  const drive = new GoogleDrive({
    client: { client_id: "client", client_secret: "secret" },
    now: () => now,
    commitAccount: async () => {
      if (fail) throw Error("disk full");
    },
    transport: {
      request: async (o) =>
        o.url.endsWith("/device/code")
          ? result(200, {
              verification_url: "https://www.google.com/device",
              user_code: "ABC",
              device_code: "private",
              expires_in: 100,
              interval: 1,
            })
          : o.url.includes("/about?")
            ? result(200, {user:{emailAddress:"new@example.com"}})
            : result(200, {
              access_token: "new",
              refresh_token: "refresh",
              expires_in: 3600,
              scope: "https://www.googleapis.com/auth/drive.file",
            }),
    },
  });
  await drive.beginSetup();
  now = 1000;
  await assert.rejects(drive.pollSetup(), /disk full/);
  assert.equal(drive.account, null);
  fail = false;
  await drive.pollSetup();
  assert.equal(drive.account.refreshToken, "refresh");
});
test("an old token refresh cannot restore credentials after an account-change cancellation", async () => {
  let finish,
    committed = 0;
  const drive = new GoogleDrive({
    account: {
      generation: "old",
      accessToken: "old",
      refreshToken: "old-refresh",
      expiresAt: 0,
    },
    commitAccount: async () => committed++,
    transport: { request: () => new Promise((r) => (finish = r)) },
  });
  const pending = drive.refresh();
  drive.cancelSetup();
  finish(result(200, { access_token: "old-new", expires_in: 3600 }));
  await assert.rejects(pending, /cancelled/);
  assert.equal(committed, 0);
});
test("cancelling during durable consent commit restores the previous account", async () => {
  let release, entered;
  const committing = new Promise((r) => (entered = r));
  const old = { generation: "old", accessToken: "old", refreshToken: "old" };
  let persisted = old;
  const drive = new GoogleDrive({
    account: old,
    commitAccount: async (next) => {
      persisted = next;
      entered();
      await new Promise((r) => (release = r));
      return async () => {
        persisted = old;
      };
    },
  });
  drive.pendingAccount = {
    generation: "new",
    accessToken: "new",
    refreshToken: "new",
    email: "new@example.com",
  };
  const pending = drive.pollSetup();
  await committing;
  const cancelled = drive.cancelSetup();
  release();
  await pending;
  await cancelled;
  assert.equal(persisted.generation, "old");
  assert.equal(drive.account.generation, "old");
});
test("Google upload metadata respects property limits and replaces stable metadata IDs", async () => {
  const requests = [];
  const drive = new GoogleDrive({
    account: { accessToken: "token", expiresAt: 9999999999999 },
    transport: {
      request: async (o) => {
        requests.push(o);
        return result(
          200,
          {},
          {
            location:
              "https://www.googleapis.com/upload/drive/v3/files?upload_id=x",
          },
        );
      },
    },
  });
  await drive.beginUpload({
    remoteId: "file-id",
    name: "manifest.json",
    size: 50,
    parent: "folder",
    key: "x".repeat(116),
    replacing: true,
  });
  const request = requests[0],
    metadata = JSON.parse(request.body);
  assert.equal(request.method, "PATCH");
  assert.match(request.url, /files\/file-id\?/);
  assert.equal(metadata.id, undefined);
  assert.equal(metadata.parents, undefined);
  for (const [key, value] of Object.entries(metadata.appProperties))
    assert.ok(Buffer.byteLength(key + value) <= 124);
});

function consentFixture(overrides={}) {
 let now=0;const calls=[],commits=[],old={generation:'old',accessToken:'old-token',refreshToken:'old-refresh',email:'old@example.com'};
 const drive=new GoogleDrive({client:{client_id:'client',client_secret:'client-secret'},account:old,now:()=>now,commitAccount:async account=>commits.push(account),transport:{request:async options=>{
  calls.push(options);
  if(options.url.endsWith('/device/code'))return result(200,{verification_url:'https://www.google.com/device',user_code:'ABC',device_code:'private',expires_in:1800,interval:1});
  if(options.url.includes('/about?'))return overrides.identity?overrides.identity(options):result(200,{user:{emailAddress:'NEW@Example.com',displayName:'New user'}});
  return result(200,{access_token:'candidate-token',refresh_token:'candidate-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/drive.file'});
 }}});return {drive,calls,commits,old,setNow:value=>now=value};
}
test('consent hydrates the candidate identity with its own token before atomically switching accounts',async()=>{
 const f=consentFixture();await f.drive.beginSetup();f.setNow(1000);assert.equal(await f.drive.pollSetup(),true);
 const identity=f.calls.find(call=>call.url.includes('/about?'));assert.equal(identity.headers.Authorization,'Bearer candidate-token');assert.equal(f.commits.length,1);assert.equal(f.commits[0].email,'new@example.com');assert.equal(f.drive.account.email,'new@example.com');assert.equal(f.drive.account.label,'NEW@Example.com');assert.equal(f.drive.setupStatus(),null);
});
test('identity failure keeps old account and retries the pending candidate without a second device token grant',async()=>{
 let attempts=0;const f=consentFixture({identity:async()=>++attempts===1?result(503,{}):result(200,{user:{emailAddress:'new@example.com'}})});await f.drive.beginSetup();f.setNow(1000);
 await assert.rejects(f.drive.pollSetup(),e=>e.code==='retry');assert.equal(f.drive.account,f.old);assert.equal(f.commits.length,0);assert(f.drive.pendingAccount);
 assert.equal(await f.drive.pollSetup(),true);assert.equal(f.calls.filter(call=>call.url.endsWith('/token')).length,1);assert.equal(f.drive.account.email,'new@example.com');
});
test('missing or invalid candidate email never commits credentials needed by phone backup',async()=>{
 for(const email of [undefined,'','bad','bad email@example.com','a@b\r\n']){const f=consentFixture({identity:async()=>result(200,{user:{emailAddress:email}})});await f.drive.beginSetup();f.setNow(1000);await assert.rejects(f.drive.pollSetup(),/identity|email/i);assert.equal(f.drive.account,f.old);assert.equal(f.commits.length,0);}
});
test('cancellation while candidate identity is pending cannot commit or mutate the old account',async()=>{
 let release;const f=consentFixture({identity:()=>new Promise(resolve=>release=resolve)});await f.drive.beginSetup();f.setNow(1000);const pending=f.drive.pollSetup();for(let n=0;!release&&n<20;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function','identity must be read before commit');await f.drive.cancelSetup();release(result(200,{user:{emailAddress:'new@example.com'}}));await assert.rejects(pending,e=>e.code==='cancelled');assert.equal(f.drive.account,f.old);assert.equal(f.commits.length,0);assert.equal(f.drive.pendingAccount,null);
});
test('concurrent pending consent polls share one identity lookup and one durable commit',async()=>{
 let release;const f=consentFixture({identity:()=>new Promise(resolve=>release=resolve)});await f.drive.beginSetup();f.setNow(1000);
 const first=f.drive.pollSetup();for(let n=0;!release&&n<20;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');const second=f.drive.pollSetup();release(result(200,{user:{emailAddress:'new@example.com'}}));assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(f.calls.filter(call=>call.url.includes('/about?')).length,1);assert.equal(f.commits.length,1);
});
test('pending consent refreshes its expired candidate without installing or refreshing the old account',async()=>{
 let now=5000;const old={accessToken:'old',refreshToken:'old-refresh',email:'old@example.com'},calls=[],commits=[];
 const drive=new GoogleDrive({client:{client_id:'client',client_secret:'secret'},account:old,now:()=>now,commitAccount:async value=>commits.push(value),transport:{request:async options=>{calls.push(options);assert.equal(drive.account,old);if(options.url.endsWith('/token')){assert.match(options.body,/refresh_token=candidate-refresh/);assert.doesNotMatch(options.body,/old-refresh/);return result(200,{access_token:'fresh-candidate',expires_in:3600});}assert.equal(options.headers.Authorization,'Bearer fresh-candidate');return result(200,{user:{emailAddress:'new@example.com'}});}}});
 drive.pendingAccount={generation:'new',accessToken:'expired-candidate',refreshToken:'candidate-refresh',expiresAt:0};assert.equal(await drive.pollSetup(),true);assert.equal(calls.length,2);assert.equal(commits.length,1);assert.equal(drive.account.accessToken,'fresh-candidate');assert.equal(drive.account.email,'new@example.com');
});
test('starting a replacement setup while identity lookup is pending invalidates the earlier candidate',async()=>{
 let release;const f=consentFixture({identity:()=>new Promise(resolve=>release=resolve)});await f.drive.beginSetup();f.setNow(1000);const pending=f.drive.pollSetup();for(let n=0;!release&&n<20;n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');await f.drive.beginSetup();release(result(200,{user:{emailAddress:'retired@example.com'}}));await assert.rejects(pending,e=>e.code==='cancelled');assert.equal(f.drive.account,f.old);assert.equal(f.commits.length,0);assert(f.drive.setupStatus());assert.equal(f.drive.pendingAccount,null);
});
