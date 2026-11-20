"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { BackupService } = require("../recorder/files/backup-service");
test("backup service exposes Wi-Fi setup status without credentials and closes independently of capture", async (t) => {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "bv-service-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = new BackupService({
    directory: dir,
    network: { snapshot: async () => ({ eligible: false }), close: () => {} },
    client: { client_id: "id", client_secret: "secret" },
    context: () => ({
      library: null,
      guard: null,
      recording: { metrics: { queuedBytes: 0 } },
    }),
  });
  await service.init();
  assert.equal(service.status().configured, false);
  await service.command({ id: "setup", action: "setup" });
  assert.match(service.status().message, /Wi-Fi/);
  assert.ok(!JSON.stringify(service.status()).includes("secret"));
  await service.close();
});
test("drive lock mutation waits for cancelled cloud reads and blocks new backup ticks", async () => {
  const BackupService =
    require("../recorder/files/backup-service").BackupService;
  let requests = 0,
    cancelled = false,
    release;
  const service = new BackupService({
    network: {
      snapshot: async () => {
        requests++;
        return { eligible: true };
      },
    },
    transport: {
      cancel: () => {
        cancelled = true;
      },
    },
  });
  service.worker = {
    cancel: () => {},
    hashes: new Map(),
    verifiedThisRun: new Set(),
    scanAt: 10,
    retryAt: 10,
  };
  service.busy = new Promise((r) => (release = r));
  let mutated = false;
  const pending = service.withLibraryMutation(async () => {
    assert.equal(cancelled, true);
    mutated = true;
  });
  await service.tick();
  assert.equal(requests, 0);
  assert.equal(mutated, false);
  release();
  await pending;
  assert.equal(mutated, true);
  assert.equal(service.worker.scanAt, 0);
  assert.equal(service.worker.retryAt, 0);
  assert.equal(service.mutations, 0);
});
test("speed permission cancels an in-flight upload on threshold crossing or uncertainty",()=>{
 let allow=true,cancels=0,transportCancels=0;
 const s=new BackupService({stationaryPermitted:()=>allow,context:()=>({}),transport:{cancel:()=>transportCancels++}});
 s.worker={data:{settings:{doNotBackupWhileDriving:true}},cancel:()=>cancels++,retryAt:42};
 s.sampleUploadPermission();assert.equal(s.context().uploadPermitted(),true);
 allow=false;s.sampleUploadPermission();assert.equal(cancels,1);assert.equal(transportCancels,1);assert.equal(s.context().uploadPermitted(),false);
 s.sampleUploadPermission();assert.equal(cancels,1);
 allow=true;s.sampleUploadPermission();assert.equal(s.worker.retryAt,0);
 const unknown=new BackupService({context:()=>({})});assert.equal(unknown.context().uploadPermitted(),true);
});
test("an upload allowed between two disallowed timer samples is still cancelled",()=>{
 let allow=false,cancels=0;const s=new BackupService({stationaryPermitted:()=>allow,context:()=>({}),transport:{cancel:()=>{}}});s.worker={data:{settings:{doNotBackupWhileDriving:true}},cancel:()=>cancels++};
 s.sampleUploadPermission();allow=true;assert.equal(s.context().uploadPermitted(),true);allow=false;s.sampleUploadPermission();assert.equal(cancels,1);
});
test("upload speed opt-out defaults off and is independent of recording pause",()=>{
 let stationary=false;const s=new BackupService({stationaryPermitted:()=>stationary});
 s.worker={data:{settings:{pauseRecording:true}}};assert.equal(s.uploadAllowed(),true);
 s.worker.data.settings.doNotBackupWhileDriving=true;assert.equal(s.uploadAllowed(),false);
 s.worker.data.settings.pauseRecording=false;assert.equal(s.uploadAllowed(),false);
 stationary=true;assert.equal(s.uploadAllowed(),true);
 s.worker.data.settings.doNotBackupWhileDriving=false;stationary=false;assert.equal(s.uploadAllowed(),true);
});
test('phone availability verifies an uncached account only through actual eligible car Wi-Fi',async()=>{let eligible=false,calls=0;const s=new BackupService({network:{snapshot:async()=>({eligible})}});s.worker={data:{account:{generation:'g'},settings:{}},save:async()=>{}};s.phone={status:()=>({available:!!s.worker.data.account.email})};s.google={about:async()=>{calls++;return {email:'car@example.com'};}};assert.equal((await s.phoneRequest('status')).available,false);assert.equal(calls,0);eligible=true;assert.equal((await s.phoneRequest('status')).available,true);assert.equal(calls,1);await s.phoneRequest('status');assert.equal(calls,1);});

test('whole-drive enqueue serializes worker, source changes and account commands without revoking active leases',async()=>{
 const service=new BackupService({network:{snapshot:async()=>({eligible:false})},transport:{cancel(){}},context:()=>({})});
 let finishWorker,finishEnqueue; const events=[];
 service.worker={data:{account:{email:'car@example.com'}},cancel(){events.push('cancel');},hashes:new Map(),verifiedThisRun:new Set(),command:async()=>{events.push('command');}};
 service.busy=new Promise(resolve=>{finishWorker=resolve;});
 service.phone={live:()=>null,enqueue:async()=>{events.push('enqueue');await new Promise(resolve=>{finishEnqueue=resolve;});events.push('durable');return {queued:30,pending:true};}};
 const enqueuing=service.phoneRequest('enqueue',null,{clipIds:[]});
 const changing=service.withLibraryMutation(async()=>{events.push('source');});
 const command=service.command({id:'disconnect',action:'disconnect'});
 assert.deepEqual(events,['cancel']);
 finishWorker();
 while(!finishEnqueue)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,['cancel','enqueue']);
 finishEnqueue();assert.deepEqual(await enqueuing,{queued:30,pending:true});
 await Promise.all([changing,command]);
 assert.ok(events.indexOf('durable')<events.indexOf('source'));
 assert.ok(events.indexOf('durable')<events.indexOf('command'));
 const count=events.length;service.phone.live=()=>({});
 await assert.rejects(service.phoneRequest('enqueue',null,{}),/active/);
 assert.equal(events.length,count);
});
test('viewer connection stops only car Wi-Fi work and never revokes a phone upload lease',()=>{let connected=false,cancelled=0;const service=new BackupService({context:()=>({}),viewerConnected:()=>connected,transport:{cancel(){}}});service.worker={cancel:()=>cancelled++,data:{settings:{doNotBackupWhileDriving:false}},retryAt:0};service.phone={live:()=>null};service.sampleUploadPermission();connected=true;service.sampleUploadPermission();assert.equal(cancelled,1);assert.equal(service.uploadAllowed(),true);assert.equal(service.context().viewerConnected(),true);service.sampleUploadPermission();assert.equal(cancelled,1);connected=false;service.sampleUploadPermission();service.phone.live=()=>({});connected=true;service.sampleUploadPermission();assert.equal(cancelled,1);});
