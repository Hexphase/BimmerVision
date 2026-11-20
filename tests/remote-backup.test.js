"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { RemoteBackup } = require("../recorder/files/remote-backup"),
  { State } = require("../recorder/files/backup-state"),
  { Library } = require("../recorder/files/library");
async function fixture(t, options) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "bv-backup-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "recordings"));
  fs.mkdirSync(path.join(dir, "state"), 0o700);
  let connected = true;
  const guard = {
    identity: "test-usb",
    check: async () => {
      if (!connected) throw Error("USB removed");
    },
  };
  const library = new Library(path.join(dir, "recordings"), { guard }),
    state = new State(path.join(dir, "state"));
  const data = await state.load();
  data.account = { generation: "account", accessToken: "secret" };
  data.settings = {
    autoUpload: true,
    pauseRecording: false,
    serviceId: "Home",
  };
  await state.save(data);
  const remote = new Map();
  let serial = 0,
    ambiguous = false;
  const drive = {
    account: data.account,
    setupStatus: () => null,
    about: async () => ({ limit: 99999999, usage: 0, label: "Tester" }),
    allocateId: async () => String(++serial),
    createFolder: async (id) => {
      remote.set(id, { mimeType: "application/vnd.google-apps.folder" });
    },
    inspectFile: async (id) => {
      if (!remote.has(id)) {
        const e = Error("missing");
        e.code = "not-found";
        throw e;
      }
      const f = remote.get(id);
      return {
        id,
        size: String(f.bytes ? f.bytes.length : 0),
        md5Checksum: f.bytes
          ? crypto.createHash("md5").update(f.bytes).digest("hex")
          : null,
        mimeType: f.mimeType,
      };
    },
    beginUpload: async (file) => {
      remote.set(file.remoteId, { bytes: Buffer.alloc(0), file });
      return "session-" + file.remoteId;
    },
    queryUpload: async (session) => {
      const f = remote.get(session.slice(8));
      return {
        offset: f.bytes.length,
        complete: f.bytes.length === f.file.size,
      };
    },
    uploadChunk: async (session, offset, bytes, total) => {
      const f = remote.get(session.slice(8));
      assert.equal(offset, f.bytes.length);
      f.bytes = Buffer.concat([f.bytes, bytes]);
      if (ambiguous) {
        ambiguous = false;
        throw Error("response lost");
      }
      return { offset: f.bytes.length, complete: f.bytes.length === total };
    },
  };
  let clock = Date.parse("2026-11-16T20:00:00Z");
  const worker = new RemoteBackup(Object.assign({ state, google: drive, now: () => clock }, options));
  await worker.init();
  async function clip(id, previousId) {
    const folder = path.join(library.root, id);
    fs.mkdirSync(folder);
    const bytes = Buffer.alloc(1048576 + 23, 7);
    fs.writeFileSync(path.join(folder, "capture.bvr"), bytes);
    fs.writeFileSync(
      path.join(folder, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        format: "bvr1",
        id,
        sessionId: "session",
        sequence: previousId ? 2 : 1,
        startedAt: "2026-11-16T12:00:00Z",
        durationSeconds: 60,
        startMonotonicUs: previousId ? 60000000 : 0,
        endMonotonicUs: previousId ? 120000000 : 60000000,
        bytes: bytes.length,
        complete: true,
        requiresPrevious: !!previousId,
        previousId: previousId || null,
      }),
    );
    return bytes;
  }
  const context = {
    library,
    guard,
    recording: { activeId: null, metrics: { queuedBytes: 0 } },
    network: { eligible: true, serviceId: "Home" },
  };
  return {
    worker,
    clip,
    context,
    remote,
    state,
    drive,
    advance: (ms) => { clock += ms; },
    step: async () => {
      clock += 10000;
      await worker.tick(context);
    },
    removed: () => {
      connected = false;
    },
    loseResponse: () => {
      ambiguous = true;
    },
  };
}
test("backup verifies complete source bundles and resumes ambiguous bytes without duplicate files", async (t) => {
  const f = await fixture(t),
    id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    original = await f.clip(id);
  f.loseResponse();
  for (let i = 0; i < 30; i++) await f.step();
  const s = f.worker.status();
  assert.equal(s.completed.length, 1);
  assert.equal(s.drives[0].verifiedClips, 1);
  const copies = Array.from(f.remote.values()).filter(
    (x) => x.file && x.file.name === "capture.bvr",
  );
  assert.equal(copies.length, 1);
  assert.deepEqual(copies[0].bytes, original);
  assert.deepEqual(
    fs.readFileSync(path.join(f.context.library.root, id, "capture.bvr")),
    original,
  );
});
test("missing predecessor prevents a dependent drive being declared backed up", async (t) => {
  const f = await fixture(t);
  await f.clip(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  for (let i = 0; i < 5; i++) await f.step();
  assert.equal(f.worker.status().completed.length, 0);
  assert.match(f.worker.status().state, /dependency/i);
});
test("full storage pauses backup and USB removal never modifies source recordings", async (t) => {
  const f = await fixture(t),
    id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    bytes = await f.clip(id);
  f.drive.about = async () => ({ limit: 1, usage: 1 });
  await f.step();
  assert.equal(f.worker.status().storageFull, true);
  f.removed();
  await f.step();
  assert.equal(f.worker.status().storageFull, true);
  assert.equal(f.worker.status().completed.length, 0);
  assert.deepEqual(
    fs.readFileSync(path.join(f.context.library.root, id, "capture.bvr")),
    bytes,
  );
});
test("a restarted worker reconciles an expired session and keeps exactly one completed drive log", async (t) => {
  const f = await fixture(t),
    id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await f.clip(id);
  await f.step();
  await f.step();
  const persisted = await f.state.load(),
    pending = persisted.queue[0].files.find((x) => x.session && !x.done);
  assert.ok(pending);
  f.remote.delete(pending.remoteId);
  f.worker.close();
  const resumed = new RemoteBackup({
    state: f.state,
    google: f.drive,
    now: () => Date.parse("2026-11-17T20:00:00Z"),
  });
  await resumed.init();
  const original = f.drive.queryUpload;
  let expire = true;
  f.drive.queryUpload = async (...a) => {
    if (expire) {
      expire = false;
      const e = Error("expired");
      e.code = "not-found";
      throw e;
    }
    return original(...a);
  };
  for (let i = 0; i < 30; i++) await resumed.tick(f.context);
  assert.equal(resumed.status().completed.length, 1);
  await resumed.tick(f.context);
  assert.equal(resumed.status().completed.length, 1);
});
test("new USB identity cannot inherit another drive completion receipt", async (t) => {
  const f = await fixture(t);
  await f.clip("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  for (let i = 0; i < 15; i++) await f.step();
  assert.equal(f.worker.status().completed.length, 1);
  f.context.guard.identity = "different-usb";
  await f.step();
  assert.equal(f.worker.status().completed.length, 0);
  assert.equal(f.worker.status().drives[0].verifiedClips, 0);
});
test("a consumed native command is not replayed after the recorder restarts", async (t) => {
  const f = await fixture(t);
  await f.worker.command(
    { id: "toggle", action: "settings", autoUpload: false },
    f.context.network,
  );
  const resumed = new RemoteBackup({ state: f.state, google: f.drive });
  await resumed.init();
  await resumed.command(
    { id: "toggle", action: "settings", autoUpload: true },
    f.context.network,
  );
  assert.equal(resumed.status().autoUpload, false);
});
test("dependency closure across groups must be remotely verified before completion", async (t) => {
  const f = await fixture(t),
    a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    missing = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await f.clip(a, missing);
  await f.clip(b, a);
  const file = path.join(f.context.library.root, b, "manifest.json"),
    m = JSON.parse(fs.readFileSync(file));
  m.sessionId = "later";
  m.startedAt = "2026-11-16T13:00:00Z";
  m.sequence = 1;
  fs.writeFileSync(file, JSON.stringify(m));
  for (let i = 0; i < 25; i++) await f.step();
  assert.equal(f.worker.status().completed.length, 0);
  assert.ok(f.worker.status().drives.every((d) => d.progress < 1));
});
test("changing metadata replaces its stable cloud object without duplicate manifests", async (t) => {
  const f = await fixture(t),
    id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await f.clip(id);
  for (let i = 0; i < 15; i++) await f.step();
  const file = path.join(f.context.library.root, id, "manifest.json"),
    m = JSON.parse(fs.readFileSync(file));
  m.locked = true;
  fs.writeFileSync(file, JSON.stringify(m));
  for (let i = 0; i < 15; i++) await f.step();
  const manifests = Array.from(f.remote.values()).filter(
    (x) => x.file && x.file.name === "manifest.json",
  );
  assert.equal(manifests.length, 1);
  assert.equal(JSON.parse(manifests[0].bytes).locked, true);
  assert.equal(f.worker.status().completed.length, 1);
});
test("a new mount rehashes persisted completions even when source identity and stat signatures recur", async (t) => {
  const f = await fixture(t),
    id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await f.clip(id);
  for (let i = 0; i < 15; i++) await f.step();
  const file = path.join(f.context.library.root, id, "capture.bvr");
  fs.writeFileSync(file, Buffer.alloc(1048576 + 23, 9));
  const st = fs.statSync(file),
    saved = await f.state.load();
  saved.queue[0].files.find((x) => x.name === "capture.bvr").signature = [
    st.dev,
    st.ino,
    st.size,
    st.mtime.getTime(),
    st.ctime.getTime(),
  ].join(":");
  await f.state.save(saved);
  const resumed = new RemoteBackup({
    state: f.state,
    google: f.drive,
    now: () => Date.parse("2026-11-17T20:00:00Z"),
  });
  await resumed.init();
  await resumed.tick(f.context);
  assert.equal(resumed.status().completed.length, 0);
});
test("cancelling a credential replacement restores the previous queue and history transaction", async (t) => {
  const f = await fixture(t);
  await f.clip("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  for (let i = 0; i < 15; i++) await f.step();
  const previous = await f.state.load();
  const rollback = await f.drive.commitAccount({
    generation: "replacement",
    accessToken: "new",
    refreshToken: "new",
  });
  assert.equal(f.worker.status().completed.length, 0);
  assert.equal(typeof rollback, "function");
  await rollback();
  const restored = await f.state.load();
  assert.deepEqual(restored.queue, previous.queue);
  assert.deepEqual(restored.completed, previous.completed);
  assert.equal(restored.account.generation, "account");
});

test("evicted completed drives never acquire a new completion timestamp", async (t) => {
  const f = await fixture(t);
  for (let i = 1; i <= 6; i++) {
    const id = String(i).repeat(8) + "-aaaa-4aaa-8aaa-" + String(i).repeat(12);
    await f.clip(id);
    const file = path.join(f.context.library.root, id, "manifest.json"),
      m = JSON.parse(fs.readFileSync(file));
    m.sessionId = "session-" + i;
    m.startedAt = "2026-11-16T" + String(10 + i).padStart(2, "0") + ":00:00Z";
    fs.writeFileSync(file, JSON.stringify(m));
    for (let j = 0; j < 15; j++) await f.step();
  }
  const before = JSON.parse(JSON.stringify(f.worker.status().completed));
  assert.equal(before.length, 5);
  for (let i = 0; i < 5; i++) await f.step();
  assert.deepEqual(f.worker.status().completed, before);
});
test("linked clips in one drive upload their predecessor before the dependent clip", async (t) => {
  const f = await fixture(t),
    a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await f.clip(a);
  await f.clip(b, a);
  for (let i = 0; i < 35; i++) await f.step();
  assert.equal(f.worker.status().completed.length, 1);
  assert.equal(f.worker.status().drives[0].verifiedClips, 2);
});

test("recorded drive list is newest first and a drive lock protects every completed clip", async (t) => {
  const f = await fixture(t),
    a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await f.clip(a);
  await f.clip(b, a);
  await f.clip(c);
  const file = path.join(f.context.library.root, c, "manifest.json"),
    m = JSON.parse(fs.readFileSync(file));
  m.sessionId = "later";
  m.startedAt = "2026-11-16T18:00:00Z";
  fs.writeFileSync(file, JSON.stringify(m));
  const drives = await f.context.library.driveGroups();
  assert.equal(drives.length, 2);
  assert.equal(drives[0].id, c);
  assert.equal(drives[1].totalClips, 2);
  await f.context.library.setDriveLocked(
    drives[1].id,
    drives[1].membership,
    true,
  );
  assert.equal((await f.context.library.manifest(a)).locked, true);
  assert.equal((await f.context.library.manifest(b)).locked, true);
  assert.notEqual((await f.context.library.manifest(c)).locked, true);
  await assert.rejects(f.context.library.remove(a), /locked/);
});
test("drive lock rejects stale grouping or a busy member before changing any clip", async (t) => {
  const f = await fixture(t),
    a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await f.clip(a);
  const old = (await f.context.library.driveGroups())[0];
  await f.clip(b, a);
  await assert.rejects(
    f.context.library.setDriveLocked(a, old.membership, true),
    /changed/i,
  );
  assert.notEqual((await f.context.library.manifest(a)).locked, true);
  const fresh = (await f.context.library.driveGroups())[0],
    release = await f.context.library.acquire(b);
  await assert.rejects(
    f.context.library.setDriveLocked(a, fresh.membership, true),
    /transferring/i,
  );
  release();
  assert.notEqual((await f.context.library.manifest(a)).locked, true);
});
test("locked-only backup uploads one selected drive and excludes unlocked and partially locked drives", async (t) => {
  const f = await fixture(t),
    a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await f.clip(a);
  await f.clip(b, a);
  await f.clip(c);
  const file = path.join(f.context.library.root, c, "manifest.json"),
    m = JSON.parse(fs.readFileSync(file));
  m.sessionId = "later";
  m.startedAt = "2026-11-16T18:00:00Z";
  fs.writeFileSync(file, JSON.stringify(m));
  await f.context.library.setLocked(a, true);
  await f.context.library.setLocked(c, true);
  await f.worker.command(
    { id: "only-locked", action: "settings", onlyLockedDrives: true },
    f.context.network,
  );
  assert.equal(f.worker.status().onlyLockedDrives, true);
  for (let i = 0; i < 25; i++) await f.step();
  const copies = Array.from(f.remote.values()).filter(
    (x) => x.file && x.file.name === "capture.bvr",
  );
  assert.equal(copies.length, 1);
  assert.ok(copies.every((x) => x.file.key.includes(c)));
  assert.equal(f.worker.status().completed.length, 1);
  assert.equal(f.worker.status().remainingDrives, 0);
  await f.worker.command(
    { id: "all-drives", action: "settings", onlyLockedDrives: false },
    f.context.network,
  );
  for (let i = 0; i < 35; i++) await f.step();
  assert.equal(
    Array.from(f.remote.values()).filter(
      (x) => x.file && x.file.name === "capture.bvr",
    ).length,
    3,
  );
});
test("locked-only mode never uploads an unlocked predecessor from another drive", async (t) => {
  const f = await fixture(t),
    a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await f.clip(a);
  await f.clip(b, a);
  const file = path.join(f.context.library.root, b, "manifest.json"),
    m = JSON.parse(fs.readFileSync(file));
  m.sessionId = "later";
  m.startedAt = "2026-11-16T18:00:00Z";
  fs.writeFileSync(file, JSON.stringify(m));
  await f.context.library.setLocked(b, true);
  await f.worker.command(
    { id: "locked", action: "settings", onlyLockedDrives: true },
    f.context.network,
  );
  for (let i = 0; i < 10; i++) await f.step();
  assert.equal(f.remote.size, 0);
  assert.equal(f.worker.status().completed.length, 0);
});
test("car drive commands are USB-bound, reject stale membership and ignore startup replays", async (t) => {
  const f = await fixture(t),
    id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await f.clip(id);
  const Manager = require("../recorder/files/recorded-drives").RecordedDrives;
  let token = "usb-one";
  const manager = new Manager({
    context: () => ({ library: f.context.library, volumeToken: token }),
    mutate: (fn) => fn(),
  });
  await manager.command({
    id: "old-command",
    action: "lock",
    volumeToken: token,
    driveId: id,
    locked: true,
  });
  assert.notEqual((await f.context.library.manifest(id)).locked, true);
  await manager.command({
    id: "list",
    action: "list",
    volumeToken: token,
    page: 0,
  });
  const listed = manager.status(token);
  assert.equal(listed.drives[0].id, id);
  await manager.command({
    id: "wrong-usb",
    action: "lock",
    volumeToken: "usb-two",
    driveId: id,
    membership: listed.drives[0].membership,
    locked: true,
  });
  assert.notEqual((await f.context.library.manifest(id)).locked, true);
  await manager.command({
    id: "lock",
    action: "lock",
    volumeToken: token,
    driveId: id,
    membership: listed.drives[0].membership,
    locked: true,
  });
  assert.equal((await f.context.library.manifest(id)).locked, true);
  assert.equal(manager.status(token).drives[0].locked, true);
  token = "usb-two";
  assert.equal(manager.status(token).drives.length, 0);
});
test("an interrupted whole-drive lock stays partly locked and ineligible until retried", async (t) => {
  const f = await fixture(t),
    a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const original = await f.clip(a);
  await f.clip(b, a);
  const drive = (await f.context.library.driveGroups())[0],
    normal = f.context.guard.check;
  let failed = false;
  f.context.guard.check = async () => {
    await normal();
    if (
      !failed &&
      JSON.parse(
        fs.readFileSync(path.join(f.context.library.root, a, "manifest.json")),
      ).locked === true
    ) {
      failed = true;
      throw Error("USB removed during lock");
    }
  };
  await assert.rejects(
    f.context.library.setDriveLocked(a, drive.membership, true),
    /USB removed/,
  );
  f.context.guard.check = normal;
  const partial = (await f.context.library.driveGroups())[0];
  assert.equal(partial.mixed, true);
  assert.equal(partial.locked, false);
  await f.worker.command(
    { id: "partial-locked", action: "settings", onlyLockedDrives: true },
    f.context.network,
  );
  for (let i = 0; i < 4; i++) await f.step();
  assert.equal(f.remote.size, 0);
  await f.context.library.setDriveLocked(a, partial.membership, true);
  for (let i = 0; i < 30; i++) await f.step();
  assert.equal(f.worker.status().completed.length, 1);
  assert.deepEqual(
    fs.readFileSync(path.join(f.context.library.root, a, "capture.bvr")),
    original,
  );
});
test("per-clip unlock immediately excludes a drive without waiting for the scan cache", async (t) => {
  const f = await fixture(t),
    id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await f.clip(id);
  await f.context.library.setLocked(id, true);
  await f.worker.command(
    { id: "locked", action: "settings", onlyLockedDrives: true },
    f.context.network,
  );
  await f.step();
  const bytes = () =>
      Array.from(f.remote.values()).reduce(
        (n, x) => n + (x.bytes ? x.bytes.length : 0),
        0,
      ),
    before = bytes();
  assert.ok(before > 0);
  await f.context.library.setLocked(id, false);
  await f.worker.tick(f.context);
  assert.equal(bytes(), before);
});
test("a locked drive holds all member read leases while a cloud chunk is in flight", async (t) => {
  const f = await fixture(t),
    a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await f.clip(a);
  await f.clip(b, a);
  const d = (await f.context.library.driveGroups())[0];
  await f.context.library.setDriveLocked(d.id, d.membership, true);
  await f.worker.command(
    { id: "locked", action: "settings", onlyLockedDrives: true },
    f.context.network,
  );
  const upload = f.drive.uploadChunk;
  let checked = false;
  f.drive.uploadChunk = async (...args) => {
    checked = true;
    await assert.rejects(f.context.library.setLocked(b, false), /transferring/);
    return upload(...args);
  };
  await f.step();
  assert.equal(checked, true);
  assert.match(f.worker.status().state, /^(Uploading|Verifying)$/);
});
test("ordinary recording buffers permit background backup; real backlog still exposes the queue",async t=>{
 const f=await fixture(t),id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";await f.clip(id);
 f.context.recording={activeId:"currently-recording",metrics:{queuedBytes:128*1024}};
 for(let i=0;i<12;i++)await f.step();
 assert.ok(f.remote.size>0,"small normal buffers must not block every upload");
 const g=await fixture(t);await g.clip(id);g.context.recording={activeId:"currently-recording",metrics:{queuedBytes:8*1024*1024}};
 await g.step();const s=g.worker.status();assert.equal(s.drives.length,1);assert.equal(s.pending,true);assert.equal(s.state,"Recording takes priority");assert.equal(g.remote.size,0);
});
test("backup samples live recorder backlog instead of a stale tick snapshot",async t=>{
 const f=await fixture(t);await f.clip("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");let reads=0;
 f.context.readRecording=()=>{reads++;return {metrics:{queuedBytes:8*1024*1024}};};
 await f.step();assert.ok(reads>0);assert.equal(f.worker.status().state,"Recording takes priority");assert.equal(f.worker.status().drives.length,1);assert.equal(f.remote.size,0);
});
test("speed gate prevents Google upload work and safely resumes below threshold",async t=>{
 const f=await fixture(t);await f.clip("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");let allowed=false;f.context.uploadPermitted=()=>allowed;
 await f.step();assert.equal(f.remote.size,0);assert.match(f.worker.status().state,/stationary/);
 allowed=true;await f.step();assert.ok(f.remote.size>0);
});
test("speed and cancellation are rechecked after an awaited USB guard",async t=>{
 const f=await fixture(t);let release,entered;const started=new Promise(r=>entered=r);f.context.guard.check=()=>{entered();return new Promise(r=>release=r);};let allow=true;f.context.uploadPermitted=()=>allow;f.worker.lastContext=f.context;
 const checking=f.worker.check(f.context,f.worker.cancelGeneration);await started;allow=false;f.worker.cancel();release();await assert.rejects(checking,/stationary|cancelled/);
});
test("measured speed remains visible while the next chunk is in flight and clears on a real pause",async t=>{
 const f=await fixture(t),id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";await f.clip(id);
 const folder=path.join(f.context.library.root,id),size=8*1048576;fs.writeFileSync(path.join(folder,"capture.bvr"),Buffer.alloc(size,7));const p=path.join(folder,"manifest.json"),m=JSON.parse(fs.readFileSync(p));m.bytes=size;fs.writeFileSync(p,JSON.stringify(m));
 for(let i=0;i<6&&!f.worker.status().bytesPerSecond;i++)await f.step();
 const speed=f.worker.status().bytesPerSecond;assert.ok(speed>0);
 let entered,release;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r),upload=f.drive.uploadChunk;f.drive.uploadChunk=async(...a)=>{entered();await gate;return upload(...a);};
 const rowStates=[];f.context.guard.check=async()=>{rowStates.push(f.worker.status().drives[0].state);};const pending=f.step();await ready;const during=f.worker.status().bytesPerSecond;release();await pending;assert.equal(during,speed);assert.ok(!rowStates.includes("Queued"));
 f.context.uploadPermitted=()=>false;await f.step();assert.equal(f.worker.status().bytesPerSecond,null);assert.equal(f.worker.status().etaSeconds,null);assert.equal(f.worker.status().drives[0].state,"Paused");
});
async function largeClip(f,id,size){await f.clip(id);const dir=path.join(f.context.library.root,id),bytes=Buffer.alloc(size,9);fs.writeFileSync(path.join(dir,'capture.bvr'),bytes);const p=path.join(dir,'manifest.json'),m=JSON.parse(fs.readFileSync(p));m.bytes=size;fs.writeFileSync(p,JSON.stringify(m));return bytes;}
test("adaptive chunks reduce request count without changing original footage",async t=>{
 const results=[];
 for(const maxUploadChunkBytes of [1048576,4194304]){
  const f=await fixture(t,{maxUploadChunkBytes}),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',original=await largeClip(f,id,11*1048576),sizes=[],upload=f.drive.uploadChunk;
  f.drive.uploadChunk=async(...a)=>{if(f.remote.get(a[0].slice(8)).file.name==='capture.bvr')sizes.push(a[2].length);f.advance(1000);return upload(...a);};
  for(let i=0;i<25&&!f.worker.status().completed.length;i++)await f.step();
  assert.equal(f.worker.status().drives[0].verifiedClips,1);assert.deepEqual([...f.remote.values()].find(v=>v.file&&v.file.name==='capture.bvr').bytes,original);results.push(sizes);
 }
 assert.equal(results[0].length,11);assert.deepEqual(results[1],[1048576,2097152,4194304,4194304]);
});
test("a timed-out larger request falls back and resumes its acknowledged bytes",async t=>{
 const f=await fixture(t),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',original=await largeClip(f,id,11*1048576),upload=f.drive.uploadChunk,sizes=[];let timedOut=false;
 f.drive.uploadChunk=async(...a)=>{const video=f.remote.get(a[0].slice(8)).file.name==='capture.bvr';if(video)sizes.push(a[2].length);f.advance(1000);const result=await upload(...a);if(video&&a[2].length===4194304&&!timedOut){timedOut=true;throw Error('Wi-Fi/TLS backup request failed (28)');}return result;};
 for(let i=0;i<30&&!f.worker.status().completed.length;i++)await f.step();
 assert.equal(timedOut,true);assert.deepEqual(sizes,[1048576,2097152,4194304,2097152,2097152]);assert.deepEqual([...f.remote.values()].find(v=>v.file&&v.file.name==='capture.bvr').bytes,original);assert.equal(f.worker.status().drives[0].verifiedClips,1);
});
test("slow successful chunks reduce the next request and chunk ceilings are bounded",async t=>{
 const f=await fixture(t),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await largeClip(f,id,11*1048576);const upload=f.drive.uploadChunk,sizes=[];let slowed=false;
 f.drive.uploadChunk=async(...a)=>{const video=f.remote.get(a[0].slice(8)).file.name==='capture.bvr';if(video)sizes.push(a[2].length);if(video&&a[2].length===4194304&&!slowed){slowed=true;f.advance(20000);}else f.advance(1000);return upload(...a);};
 for(let i=0;i<25&&!f.worker.status().completed.length;i++)await f.step();
 assert.deepEqual(sizes,[1048576,2097152,4194304,2097152,2097152]);
 for(const maxUploadChunkBytes of [0,262144,3145728,8388608,-1,NaN])assert.throws(()=>new RemoteBackup({maxUploadChunkBytes}),/chunk ceiling/);
});
test("locked-only backup includes horn-protected clips from a mixed drive without unrelated footage",async t=>{
 const f=await fixture(t),a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';await f.clip(a);await f.clip(b,a);
 const p=path.join(f.context.library.root,b,'manifest.json'),m=JSON.parse(fs.readFileSync(p));m.requiresPrevious=false;m.locked=true;m.hornLockRevision=1;fs.writeFileSync(p,JSON.stringify(m));
 await f.worker.command({id:'horn-filter',action:'settings',onlyLockedDrives:true},f.context.network);
 for(let i=0;i<15&&!f.worker.status().completed.length;i++)await f.step();
 const uploaded=[...f.remote.values()].filter(v=>v.file);assert.ok(uploaded.some(v=>v.file.key.includes(b)));assert.ok(!uploaded.some(v=>v.file.key.includes(a)));assert.equal(f.worker.status().drives[0].totalClips,1);
});
test("backup accepts another eligible Wi-Fi and migrates the old setup SSID pin",async t=>{
 const f=await fixture(t);await f.clip('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');f.context.network.serviceId='New Wi-Fi';
 for(let i=0;i<15&&!f.worker.status().completed.length;i++)await f.step();assert.ok(f.remote.size>0);assert.equal((await f.state.load()).settings.serviceId,null);
});
test('manual phone fallback uploads selected unlocked work while automatic and locked-only settings remain untouched', async t=>{const f=await fixture(t),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await f.clip(id);f.worker.data.settings.autoUpload=false;f.worker.data.settings.onlyLockedDrives=true;f.worker.data.queue.push({clipId:id,source:f.context.guard.identity,manual:true,files:[],folder:{}});for(let i=0;i<25;i++)await f.step();assert.equal(f.worker.data.queue[0].done,true);assert.equal(f.worker.data.settings.autoUpload,false);assert.equal(f.worker.data.settings.onlyLockedDrives,true);});
test('registered phone fallback creates car sessions on the same validated IDs and never calls a browser session',async t=>{const f=await fixture(t),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',original=await f.clip(id);f.worker.data.account.email='car@example.com';f.worker.data.settings.autoUpload=false;f.drive.about=async()=>({email:'car@example.com',limit:99999999,usage:0});const phone=new(require('../recorder/files/phone-backup').PhoneBackup)({worker:f.worker,context:()=>f.context,permitted:()=>true});f.worker.phone=phone;const job=await phone.claim({clipIds:[id],accountEmail:'car@example.com',consent:true});const root='phone-root',clip='phone-clip';f.remote.set(root,{mimeType:'application/vnd.google-apps.folder',name:'BimmerVision',tag:job.root.tag});f.remote.set(clip,{mimeType:'application/vnd.google-apps.folder',name:id,parent:root,tag:job.folders[0].tag});const files=job.files.map(file=>({index:file.index,remoteId:'phone-file-'+file.index,session:'https://www.googleapis.com/upload/drive/v3/files/phone-file-'+file.index+'?uploadType=resumable&upload_id=UNTRUSTED'}));job.files.forEach((file,index)=>f.remote.set(files[index].remoteId,{bytes:Buffer.alloc(0),name:file.name,parent:clip,tag:file.tag}));const inspect=f.drive.inspectFile;f.drive.inspectFile=async remote=>{const out=await inspect(remote),raw=f.remote.get(remote);return {...out,name:raw.name||raw.file&&raw.file.name,parents:raw.parent?[raw.parent]:raw.file?[raw.file.parent]:[],appProperties:{bimmervision:raw.tag||raw.file&&crypto.createHash('sha256').update(raw.file.key).digest('hex')}};};const query=f.drive.queryUpload;f.drive.queryUpload=async session=>{assert.match(session,/^session-/,'only a car-issued session may reach the transport');return query(session);};await phone.register(job.jobId,{leaseToken:job.leaseToken,rootId:root,folders:{[id]:clip},files});await phone.release(job.jobId,{leaseToken:job.leaseToken});for(let i=0;i<25;i++)await f.step();assert.equal(f.worker.data.queue[0].done,true);assert.deepEqual(f.remote.get(files.filter(file=>job.files[file.index].name==='capture.bvr')[0].remoteId).bytes,original);assert.equal(Array.from(f.remote.values()).filter(value=>value.file).length,2);assert.ok(f.worker.data.queue[0].files.every(file=>file.remoteId.indexOf('phone-file-')===0));assert.equal(f.worker.data.settings.autoUpload,false);});

test('whole-drive durable enqueue resumes all selected unlocked originals after restart with automatic backup off',async t=>{
 const f=await fixture(t),ids=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],unselected='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 await f.clip(ids[0]);await f.clip(ids[1],ids[0]);await f.clip(unselected);
 f.worker.data.account.email='car@example.com';f.worker.data.settings.autoUpload=false;f.worker.data.settings.onlyLockedDrives=true;
 const phone=new(require('../recorder/files/phone-backup').PhoneBackup)({worker:f.worker,context:()=>f.context,permitted:()=>true});
 assert.deepEqual(await phone.enqueue({clipIds:ids,accountEmail:'car@example.com',consent:true}),{queued:2,pending:true});
 // No claim, Google object, session or registration exists when the browser dies.
 assert.equal(f.remote.size,0);assert.equal(phone.live(),null);
 const restarted=new RemoteBackup({state:f.state,google:f.drive});await restarted.init();
 assert.deepEqual(restarted.data.queue.map(r=>r.clipId),ids);
 assert.equal(restarted.data.settings.autoUpload,false);assert.equal(restarted.data.settings.onlyLockedDrives,true);
 f.context.network={eligible:false};await restarted.tick(f.context);assert.equal(f.remote.size,0);
 f.context.network={eligible:true};
 for(let i=0;i<30;i++){restarted.retryAt=0;await restarted.tick(f.context);}
 assert.equal(restarted.data.queue.length,2);
 assert.ok(restarted.data.queue.every(r=>r.done && r.manual && r.files.length===2));
 assert.ok(restarted.data.queue.every(r=>r.clipId!==unselected));
 assert.equal((await f.state.load()).queue.filter(r=>r.done).length,2);
});
test('removed automatic recordings stay excluded through scanning and explicit re-add restores upload',async t=>{const f=await fixture(t),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await f.clip(id);f.worker.data.queue.push({clipId:id,source:f.context.guard.identity,manual:false,excluded:true,files:[],done:false,folder:{}});await f.worker.save();for(let i=0;i<5;i++)await f.worker.tick(f.context);assert.equal(f.worker.status().drives.length,0);assert.equal(f.worker.data.queue[0].done,false);f.worker.data.queue[0].excluded=false;f.worker.data.queue[0].manual=true;f.worker.scanAt=0;for(let i=0;i<20&&!f.worker.data.queue[0].done;i++)await f.worker.tick(f.context);assert.equal(f.worker.data.queue[0].done,true);});

test('stationary-only uploads default off, persist independently of pause and work with auto upload off',async t=>{
 const f=await fixture(t);assert.equal(f.worker.status().doNotBackupWhileDriving,false);
 await f.worker.command({id:'independent-stationary',action:'settings',autoUpload:false,doNotBackupWhileDriving:true},{eligible:true});
 assert.equal(f.worker.status().doNotBackupWhileDriving,true);assert.equal(f.worker.status().pauseRecording,false);
 const resumed=new RemoteBackup({state:f.state,google:f.drive});
 await resumed.init();
 assert.equal(resumed.status().doNotBackupWhileDriving,true);
 await resumed.command({id:'allow-moving',action:'settings',doNotBackupWhileDriving:false},{eligible:true});assert.equal(resumed.status().doNotBackupWhileDriving,false);
});
test('car uploads pause for a connected viewer and resume on Wi-Fi after it disconnects',async t=>{const f=await fixture(t),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await f.clip(id);let connected=true;f.context.viewerConnected=()=>connected;for(let i=0;i<3;i++)await f.worker.tick(f.context);assert.match(f.worker.status().state,/Phone connected/);assert.equal(f.worker.data.queue.length,0);connected=false;for(let i=0;i<20&&!f.worker.data.queue.some(r=>r.done);i++)await f.worker.tick(f.context);assert.ok(f.worker.data.queue.some(r=>r.done));});
test('viewer connection is rechecked after awaiting the USB guard',async t=>{const f=await fixture(t);let viewer=false,release,entered;const waiting=new Promise(r=>entered=r),blocked=new Promise(r=>release=r);f.context.viewerConnected=()=>viewer;f.context.guard.check=async()=>{entered();await blocked;};f.worker.lastContext=f.context;const checked=f.worker.check(f.context,f.worker.cancelGeneration,null,true);await waiting;viewer=true;release();await assert.rejects(checked,/Phone connected/);});
