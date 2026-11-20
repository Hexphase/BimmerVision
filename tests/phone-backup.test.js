'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
let PhoneBackup;
try {
    PhoneBackup = require('../recorder/files/phone-backup').PhoneBackup;
}
catch (e) {
}
const id = '00000000-0000-4000-8000-000000000001';
async function fixture(t) {
    assert.equal(typeof PhoneBackup, 'function', 'phone broker must exist');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bv-phone-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'capture.bvr');
    fs.writeFileSync(file, 'abc');
    let now = 1000, saves = 0, released = 0;
    const worker = {
        data: { account: { generation: 'g', email: 'car@example.com' }, settings: { autoUpload: false, pauseRecording: false }, queue: [] }, save: async () => {
            saves++;
        }, cancel() {
        }, now: () => now
    };
    const context = { guard: { identity: 'usb', check: async () => {
            } }, library: { backupManifests: async () => [{ id, complete: true }], acquire: async () => () => {
                released++;
            }, bundle: async () => [{ name: 'capture.bvr', path: file }] }, recording: {} };
    const broker = new PhoneBackup({
        worker, context: () => context, permitted: () => true, now: () => now
    });
    return {
        broker, worker, context, file, get saves() {
            return saves;
        }, get released() {
            return released;
        }, advance: () => {
            now += 31000;
        }
    };
}
async function register(f, job) {
    await f.broker.register(job.jobId, {
        leaseToken: job.leaseToken, rootId: 'root', folders: { [id]: 'clip' }, files: [{ index: 0, remoteId: 'file', session: 'https://www.googleapis.com/upload/drive/v3/files/file?uploadType=resumable&upload_id=abc' }]
    });
}
test('claims require known matching car account and explicit consent', async (t) => {
    const f = await fixture(t);
    await assert.rejects(f.broker.claim({ clipIds: [id], accountEmail: 'other@example.com', consent: true }));
    await assert.rejects(f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com' }));
    f.worker.data.account.email = null;
    await assert.rejects(f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true }), /Wi-Fi/);
    assert.equal(f.worker.data.queue.length, 0);
});
test('claim persists manual work before exposing bytes without enabling automatic backup', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    assert.ok(f.saves);
    assert.equal(f.worker.data.settings.autoUpload, false);
    assert.equal(f.worker.data.queue[0].manual, true);
    assert.equal(job.files[0].md5, '900150983cd24fb0d6963f7d28e17f72');
    assert.match(job.files[0].tag, /^[a-f0-9]{64}$/);
    await register(f, job);
    assert.equal((await f.broker.read(job.jobId, {
        leaseToken: job.leaseToken, index: 0, offset: 0, length: 3
    })).toString(), 'abc');
    assert.equal(f.broker.owns(id), true);
    f.advance();
    assert.equal(f.broker.owns(id), false);
    await assert.rejects(f.broker.read(job.jobId, {
        leaseToken: job.leaseToken, index: 0, offset: 0, length: 3
    }), /expired/);
    assert.ok(f.released);
});
test('bounded reads reject source changes and stale or incorrect lease credentials', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    await register(f, job);
    await assert.rejects(f.broker.read(job.jobId, {
        leaseToken: 'bad', index: 0, offset: 0, length: 3
    }));
    await assert.rejects(f.broker.read(job.jobId, {
        leaseToken: job.leaseToken, index: 0, offset: 0, length: 1048577
    }));
    fs.writeFileSync(f.file, 'changed');
    await assert.rejects(f.broker.read(job.jobId, {
        leaseToken: job.leaseToken, index: 0, offset: 0, length: 3
    }), /changed/);
});
test('registration rejects arbitrary session URLs and cannot be overwritten', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    const body = {
        leaseToken: job.leaseToken, rootId: 'root', folders: { [id]: 'clip' }, files: [{ index: 0, remoteId: 'file', session: 'https://evil.test/upload' }]
    };
    await assert.rejects(f.broker.register(job.jobId, body));
    body.files[0].session = 'https://www.googleapis.com/upload/drive/v3/files/file?uploadType=resumable&upload_id=abc';
    await f.broker.register(job.jobId, body);
    assert.equal(f.worker.data.queue[0].files[0].remoteId, undefined);
    body.files[0].remoteId = 'different';
    await assert.rejects(f.broker.register(job.jobId, body));
});
test('untrusted remote metadata never replaces a durable car target', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    await f.broker.register(job.jobId, {
        leaseToken: job.leaseToken, rootId: 'root', folders: { [id]: 'clip' }, files: [{ index: 0, remoteId: 'file', session: 'https://www.googleapis.com/upload/drive/v3/files/file?uploadType=resumable&upload_id=abc' }]
    });
    await f.broker.release(job.jobId, { leaseToken: job.leaseToken });
    f.worker.google = { about: async () => ({ email: 'car@example.com' }), inspectFile: async (remote) => ({
            id: remote, name: 'wrong', appProperties: { bimmervision: job.root.tag }, mimeType: 'application/vnd.google-apps.folder'
        }) };
    await assert.rejects(f.broker.adopt(Object.assign({}, f.context, { network: { eligible: true } })), /Untrusted/);
    assert.equal(f.worker.data.queue[0].files[0].remoteId, undefined);
});
test('phone takeover preserves a car-owned session and refuses client changes to the target', async (t) => {
    const f = await fixture(t);
    f.worker.data.folder = { id: 'carroot', created: true };
    f.worker.data.queue.push({
        clipId: id, source: 'usb', folder: { id: 'carclip', created: true }, files: [{
                name: 'capture.bvr', path: f.file, size: 3, md5: '900150983cd24fb0d6963f7d28e17f72', remoteId: 'carfile', parent: 'carclip', session: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=existing', offset: 1
            }]
    });
    const job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    assert.equal(job.root.id, 'carroot');
    assert.equal(job.files[0].remoteId, 'carfile');
    assert.equal(job.files[0].trustedExisting, true);
    assert.equal(f.worker.data.queue[0].files[0].offset, 1);
    const b = {
        leaseToken: job.leaseToken, rootId: 'carroot', folders: { [id]: 'carclip' }, files: [{ index: 0, remoteId: 'carfile', session: job.files[0].session }]
    };
    await f.broker.register(job.jobId, b);
    b.files[0].remoteId = 'evil';
    await assert.rejects(f.broker.register(job.jobId, b));
});
test('phone-created targets with unexpected nonempty content are never adopted', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    await f.broker.register(job.jobId, {
        leaseToken: job.leaseToken, rootId: 'root', folders: { [id]: 'clip' }, files: [{ index: 0, remoteId: 'file', session: 'https://www.googleapis.com/upload/drive/v3/files/file?uploadType=resumable&upload_id=abc' }]
    });
    await f.broker.release(job.jobId, { leaseToken: job.leaseToken });
    const objects = { root: {
            id: 'root', name: 'BimmerVision', mimeType: 'application/vnd.google-apps.folder', appProperties: { bimmervision: job.root.tag }
        }, clip: {
            id: 'clip', name: id, parents: ['root'], mimeType: 'application/vnd.google-apps.folder', appProperties: { bimmervision: job.folders[0].tag }
        }, file: {
            id: 'file', name: 'capture.bvr', parents: ['clip'], size: '55', md5Checksum: 'wrong', appProperties: { bimmervision: job.files[0].tag }
        } };
    f.worker.google = { about: async () => ({ email: 'car@example.com' }), inspectFile: async (remote) => objects[remote] };
    f.worker.hash = async () => ({ md5: job.files[0].md5, size: 3, signature: f.worker.data.queue[0].files[0].signature });
    await assert.rejects(f.broker.adopt(Object.assign({}, f.context, { network: { eligible: true } })), /content/);
    assert.equal(f.worker.data.queue[0].files[0].remoteId, undefined);
});
test('no source bytes leave the car before immutable remote registration is durable', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    await assert.rejects(f.broker.read(job.jobId, {
        leaseToken: job.leaseToken, index: 0, offset: 0, length: 3
    }), /Register/);
});
test('fallback validates all targets but replaces a browser-issued session with its own PATCH session', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    await register(f, job);
    await f.broker.release(job.jobId, { leaseToken: job.leaseToken });
    const objects = { root: {
            id: 'root', name: 'BimmerVision', mimeType: 'application/vnd.google-apps.folder', appProperties: { bimmervision: job.root.tag }
        }, clip: {
            id: 'clip', name: id, parents: ['root'], mimeType: 'application/vnd.google-apps.folder', appProperties: { bimmervision: job.folders[0].tag }
        }, file: {
            id: 'file', name: 'capture.bvr', parents: ['clip'], size: '0', appProperties: { bimmervision: job.files[0].tag }
        } };
    f.worker.google = { about: async () => ({ email: 'car@example.com' }), inspectFile: async (remote) => objects[remote] };
    f.worker.hash = async () => ({ md5: job.files[0].md5, size: 3, signature: f.worker.data.queue[0].files[0].signature });
    await f.broker.adopt(Object.assign({}, f.context, { network: { eligible: true } }));
    assert.equal(f.worker.data.queue[0].files[0].remoteId, 'file');
    assert.equal(f.worker.data.queue[0].files[0].session, null);
    assert.equal(f.worker.data.queue[0].files[0].replacing, true);
    assert.equal(f.broker.status().pending, 1);
});
test('a registration save in progress cannot authorize source bytes', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    let finish;
    f.worker.save = () => new Promise(resolve => {
        finish = resolve;
    });
    const saving = register(f, job);
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(f.broker.read(job.jobId, {
        leaseToken: job.leaseToken, index: 0, offset: 0, length: 3
    }), /Register/);
    finish();
    await saving;
    assert.equal((await f.broker.read(job.jobId, {
        leaseToken: job.leaseToken, index: 0, offset: 0, length: 3
    })).toString(), 'abc');
});
test('only one bounded phone source read may allocate data at a time', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    await register(f, job);
    let release;
    const blocked = new Promise(resolve => {
        release = resolve;
    });
    f.context.guard.check = () => blocked;
    const first = f.broker.read(job.jobId, {
        leaseToken: job.leaseToken, index: 0, offset: 0, length: 3
    });
    await assert.rejects(f.broker.read(job.jobId, {
        leaseToken: job.leaseToken, index: 0, offset: 0, length: 3
    }), /already active/);
    release();
    assert.equal((await first).toString(), 'abc');
});
test('claim yields while automatic recording pause drains instead of failing the job', async (t) => {
    const f = await fixture(t);
    f.context.recording.finalizing = true;
    setTimeout(() => {
        f.context.recording.finalizing = false;
    }, 30);
    const job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    assert.equal(job.files[0].md5, '900150983cd24fb0d6963f7d28e17f72');
});
test('a trusted car session remains resumable even while its unfinished file is not yet visible', async (t) => {
    const f = await fixture(t);
    f.worker.data.folder = { id: 'carroot', created: true };
    const original = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=existing';
    f.worker.data.queue.push({
        clipId: id, source: 'usb', folder: { id: 'carclip', created: true }, files: [{
                name: 'capture.bvr', path: f.file, size: 3, md5: '900150983cd24fb0d6963f7d28e17f72', remoteId: 'carfile', parent: 'carclip', session: original, offset: 1
            }]
    });
    const job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    await f.broker.register(job.jobId, {
        leaseToken: job.leaseToken, rootId: 'carroot', folders: { [id]: 'carclip' }, files: [{ index: 0, remoteId: 'carfile', session: original }]
    });
    await f.broker.release(job.jobId, { leaseToken: job.leaseToken });
    f.worker.google = { about: async () => ({ email: 'car@example.com' }), inspectFile: async (remote) => {
            if (remote === 'carfile') {
                const e = Error('unfinished');
                e.code = 'not-found';
                throw e;
            }
            return {
                id: remote, name: remote === 'carroot' ? 'BimmerVision' : id, mimeType: 'application/vnd.google-apps.folder', parents: remote === 'carroot' ? [] : ['carroot']
            };
        } };
    f.worker.hash = async () => ({ md5: job.files[0].md5, size: 3, signature: f.worker.data.queue[0].files[0].signature });
    await f.broker.adopt(Object.assign({}, f.context, { network: { eligible: true } }));
    assert.equal(f.worker.data.queue[0].files[0].session, original);
    assert.equal(f.worker.data.queue[0].files[0].remoteId, 'carfile');
});
test('a changed source snapshot reports a durable actionable recovery reason and stops remote retries', async (t) => {
    const f = await fixture(t), job = await f.broker.claim({ clipIds: [id], accountEmail: 'car@example.com', consent: true });
    await register(f, job);
    await f.broker.release(job.jobId, { leaseToken: job.leaseToken });
    let calls = 0;
    const objects = { root: {
            id: 'root', name: 'BimmerVision', mimeType: 'application/vnd.google-apps.folder', appProperties: { bimmervision: job.root.tag }
        }, clip: {
            id: 'clip', name: id, parents: ['root'], mimeType: 'application/vnd.google-apps.folder', appProperties: { bimmervision: job.folders[0].tag }
        }, file: {
            id: 'file', name: 'capture.bvr', parents: ['clip'], size: '0', appProperties: { bimmervision: job.files[0].tag }
        } };
    f.worker.google = { about: async () => {
            calls++;
            return { email: 'car@example.com' };
        }, inspectFile: async (remote) => objects[remote] };
    f.worker.hash = async () => ({ md5: 'changed', size: 3, signature: 'changed' });
    const c = Object.assign({}, f.context, { network: { eligible: true } });
    await assert.rejects(f.broker.adopt(c), /Reconnect Google Drive/);
    assert.match(f.broker.status().reason, /select the recording again/);
    assert.equal(f.worker.data.phoneJobs[0].sourceChanged, true);
    const prior = calls;
    await assert.rejects(f.broker.adopt(c), /Reconnect Google Drive/);
    assert.equal(calls, prior);
    assert.equal(f.worker.data.queue[0].files[0].remoteId, undefined);
});

const enqueueBody = (clipIds = [id]) => ({clipIds, accountEmail:'car@example.com', consent:true});
test('whole-drive enqueue durably queues all originals before a claim and survives interruption', async t => {
    const f = await fixture(t), ids = Array.from({length:45}, (_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
    f.context.library.backupManifests = async()=>ids.map(id=>({id,complete:true,locked:false}));
    f.worker.data.settings.onlyLockedDrives = true;
    let durable;
    f.worker.save = async()=> {durable=JSON.parse(JSON.stringify(f.worker.data));};
    assert.deepEqual(await f.broker.enqueue(enqueueBody(ids)), {queued:45,pending:true});
    assert.equal(durable.queue.length,45);
    assert.ok(durable.queue.every(r=>r.manual && !r.done && r.source==='usb'));
    assert.equal(durable.settings.autoUpload,false);
    assert.equal(durable.settings.onlyLockedDrives,true);
    assert.equal(durable.phoneJobs,undefined);
    f.worker.data=durable;
    const restarted=new PhoneBackup({worker:f.worker,context:()=>f.context,permitted:()=>true});
    assert.equal(restarted.live(),null);
    await restarted.claim(enqueueBody(ids.slice(0,20)));
    assert.equal(f.worker.data.queue.length,45);
});
test('enqueue validates complete selection, consent, identity, limit and ambiguous duplicates atomically', async t => {
    const f=await fixture(t), missing='00000000-0000-4000-8000-000000000002';
    for(const body of [enqueueBody([]),enqueueBody([id,missing]),enqueueBody([id,id]),enqueueBody([123]),enqueueBody(Array(1001).fill(id)),{...enqueueBody(),consent:false},{...enqueueBody(),accountEmail:'other@example.com'}]) {
        await assert.rejects(f.broker.enqueue(body));
        assert.deepEqual(f.worker.data.queue,[]);
    }
    const upper='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    await assert.rejects(f.broker.enqueue(enqueueBody([upper,upper.toLowerCase()])),/Select/);
    f.context.library.backupManifests=async()=>[{id,complete:false}];
    await assert.rejects(f.broker.enqueue(enqueueBody()),/complete/);
});
test('enqueue preserves existing receipts and rejects source, account or active lease changes', async t => {
    const f=await fixture(t), receipt={clipId:id,source:'usb',manual:false,done:true,folder:{id:'remote',created:true},phoneJob:'old',files:[{remoteId:'original',session:'original-session',offset:3,done:true,size:3}]};
    f.worker.data.queue=[receipt];
    await f.broker.enqueue(enqueueBody());
    assert.deepEqual(f.worker.data.queue[0],{...receipt,manual:true,excluded:false});
    const prior=JSON.stringify(f.worker.data.queue);
    f.context.library.acquire=async()=>{f.context.guard.identity='other';return ()=>{};};
    await assert.rejects(f.broker.enqueue(enqueueBody()),/source changed/);
    assert.equal(JSON.stringify(f.worker.data.queue),prior);
    f.context.guard.identity='usb';
    f.context.library.acquire=async()=>{f.worker.data.account={generation:'other',email:'car@example.com'};return ()=>{};};
    await assert.rejects(f.broker.enqueue(enqueueBody()),/source changed/);
    f.worker.data.account={generation:'g',email:'car@example.com'};
    f.context.library.acquire=async()=>()=>{};
    const job=await f.broker.claim(enqueueBody());
    await assert.rejects(f.broker.enqueue(enqueueBody()),/active/);
    assert.equal(f.broker.live().job.id,job.jobId);
});
test('enqueue only acknowledges durable success and rolls back a failed save', async t=>{
    const f=await fixture(t);let finish;
    f.worker.save=()=>new Promise(resolve=>{finish=resolve;});
    let settled=false;const pending=f.broker.enqueue(enqueueBody()).then(()=>{settled=true;});
    while(!finish) await new Promise(resolve=>setImmediate(resolve));
    assert.equal(settled,false);finish();await pending;
    const previous=f.worker.data.queue;
    f.worker.save=async()=>{throw Error('disk full');};
    await assert.rejects(f.broker.enqueue(enqueueBody()),/disk full/);
    assert.equal(f.worker.data.queue,previous);
});

test('pairing revocation and in-place account changes abort enqueue before durable intent',async t=>{
 const f=await fixture(t);
 f.context.library.acquire=async()=>{f.broker.revoke();return ()=>{};};
 await assert.rejects(f.broker.enqueue(enqueueBody()),/source changed/);
 assert.deepEqual(f.worker.data.queue,[]);
 f.context.library.acquire=async()=>{f.worker.data.account.generation='relinked';return ()=>{};};
 await assert.rejects(f.broker.enqueue(enqueueBody()),/source changed/);
 assert.deepEqual(f.worker.data.queue,[]);
});

test('enqueued fallback without a claim enables the configured capture pause only for current-source pending work',async t=>{
 const f=await fixture(t),{RecordingPolicy}=require('../recorder/files/backup-recording-policy');
 f.worker.data.settings.pauseRecording=true;
 await f.broker.enqueue(enqueueBody());
 f.worker.lastContext=f.context;
 const policy=new RecordingPolicy(),backup={configured:true,autoUpload:false,pauseRecording:true,pending:true,state:'Preparing',speedPermitted:true,stationaryPermitted:true,wifi:{eligible:true},phone:f.broker.status()};
 const input={intent:{continuous:true,recordingAction:'a'},backup};
 assert.equal(backup.phone.active,false);assert.equal(backup.phone.pending,1);
 assert.equal(policy.evaluate(input).temporaryPause,true);
 backup.pauseRecording=false;assert.equal(policy.evaluate(input).temporaryPause,false);
 backup.pauseRecording=true;backup.wifi.eligible=false;assert.equal(policy.evaluate(input).temporaryPause,false);
 backup.wifi.eligible=true;f.context.guard.identity='other-usb';backup.phone=f.broker.status();
 assert.equal(backup.phone.pending,0);assert.equal(policy.evaluate(input).temporaryPause,false);
 f.context.guard.identity='usb';f.worker.data.queue[0].done=true;backup.phone=f.broker.status();
 assert.equal(backup.phone.pending,0);assert.equal(policy.evaluate(input).temporaryPause,false);
});

test('a 1000-clip whole drive keeps all 50 sequential registered phone batches without car Internet',async t=>{
 const f=await fixture(t),ids=Array.from({length:1000},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
 f.context.library.backupManifests=async()=>ids.map(id=>({id,complete:true}));
 await f.broker.enqueue(enqueueBody(ids));
 for(let at=0;at<ids.length;at+=20){
  const job=await f.broker.claim(enqueueBody(ids.slice(at,at+20))),folders={};
  job.folders.forEach((folder,i)=>{folders[folder.clipId]='folder-'+at+'-'+i;});
  const files=job.files.map((file,i)=>({index:file.index,remoteId:'file-'+at+'-'+i,session:'https://www.googleapis.com/upload/drive/v3/files/file-'+at+'-'+i+'?uploadType=resumable&upload_id=abc'}));
  await f.broker.register(job.jobId,{leaseToken:job.leaseToken,rootId:'root-'+at,folders,files});
  await f.broker.release(job.jobId,{leaseToken:job.leaseToken});
 }
 assert.equal(f.worker.data.phoneJobs.length,50);
 assert.ok(f.worker.data.phoneJobs.every(job=>job.registration && !job.adopted));
 assert.equal(f.worker.data.queue.length,1000);
 assert.ok(f.worker.data.queue.every(row=>row.manual && f.worker.data.phoneJobs.some(job=>job.id===row.phoneJob)));
});
test('enqueue rejects an entire drive before partial upload when bounded phone job capacity is insufficient',async t=>{
 const f=await fixture(t),ids=Array.from({length:21},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
 f.worker.data.phoneJobs=Array.from({length:63},(_,i)=>({id:'old-'+i,adopted:false,clipIds:[],source:'usb'}));
 f.context.library.backupManifests=async()=>ids.map(id=>({id,complete:true}));
 await assert.rejects(f.broker.enqueue(enqueueBody(ids)),/car to Wi-Fi/);
 assert.equal(f.saves,0);assert.deepEqual(f.worker.data.queue,[]);assert.equal(f.worker.data.phoneJobs.length,63);
});
test('phone claim and registration reject state beyond 24 MiB before save or source reads without clobbering receipts',async t=>{
 const f=await fixture(t),limit=24*1024*1024;
 f.worker.data.padding='x'.repeat(limit);
 const queue=f.worker.data.queue;
 await assert.rejects(f.broker.claim(enqueueBody()),/car to Wi-Fi/);
 assert.equal(f.worker.data.queue,queue);assert.equal(f.saves,0);assert.equal(f.broker.live(),null);
 delete f.worker.data.padding;
 const job=await f.broker.claim(enqueueBody());
 const before=f.saves,bytes=Buffer.byteLength(JSON.stringify(f.worker.data));
 f.worker.data.padding='x'.repeat(limit-bytes-100);
 await assert.rejects(register(f,job),/car to Wi-Fi/);
 assert.equal(f.saves,before);assert.equal(f.worker.data.phoneJobs[0].registration,undefined);
 await assert.rejects(f.broker.read(job.jobId,{leaseToken:job.leaseToken,index:0,offset:0,length:3}),/Register/);
});
test('phone progress is bounded display information and never advances durable verified receipts',async t=>{const f=await fixture(t),job=await f.broker.claim({clipIds:[id],accountEmail:'car@example.com',consent:true}),total=job.files.reduce((n,v)=>n+v.size,0),before=JSON.stringify(f.worker.data.queue);await f.broker.heartbeat(job.jobId,{leaseToken:job.leaseToken,progress:{bytes:total}});assert.deepEqual(f.broker.active.progress,{bytes:total,total});assert.equal(JSON.stringify(f.worker.data.queue),before);await f.broker.heartbeat(job.jobId,{leaseToken:job.leaseToken,progress:{bytes:total+1}});assert.equal(f.broker.active.progress.bytes,total);});
