"use strict";
var fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  io = require("./io"),
  group = require("./backup-drives").group;
var CHUNK = 1024 * 1024;
function signature(st) {
  return [st.dev, st.ino, st.size, st.mtime.getTime(), st.ctime.getTime()].join(
    ":",
  );
}
function RemoteBackup(options) {
  var o = options || {};
  this.store = o.state;
  this.google = o.google;
  this.now = o.now || Date.now;
  this.maxUploadChunkBytes = o.maxUploadChunkBytes == null ? 4 * CHUNK : o.maxUploadChunkBytes;
  if ([CHUNK, 2 * CHUNK, 4 * CHUNK].indexOf(this.maxUploadChunkBytes) < 0)
    throw Error("Upload chunk ceiling must be 1, 2 or 4 MiB");
  this.uploadChunkBytes = CHUNK;
  this.data = null;
  this.view = {
    state: "Setup Remote Backup",
    drives: [],
    completed: [],
    storageFull: false,
  };
  this.busy = false;
  this.closed = false;
  this.cancelGeneration = 0;
  this.retryAt = 0;
  this.quotaAt = 0;
  this.quota = null;
  this.hashes = new Map();
  this.verifiedThisRun = new Set();
  this.lastContext = null;
  this.started = 0;
  this.sent = 0;
  this.clipReaders = new Set();
  this.scanAt = 0;
  this.scanLibrary = null;
  this.manifests = [];
  this.sessions = new Set();
}
RemoteBackup.prototype.init = async function () {
  this.data = await this.store.load();
  this.data.settings = Object.assign(
    {
      autoUpload: false,
      pauseRecording: false,
      doNotBackupWhileDriving: false,
      onlyLockedDrives: false,
      serviceId: null,
    },
    this.data.settings,
  );
  this.data.queue = this.data.queue || [];
  this.data.completed = this.data.completed || [];
  this.data.groups = this.data.groups || {};
  if (this.data.settings.serviceId != null) {
    this.data.settings.serviceId = null;
    await this.save();
  }
  this.google.account = this.data.account;
  var self = this;
  this.google.commitAccount = async function (account) {
    var snapshot = JSON.parse(JSON.stringify(self.data));
    var previous = self.data.account,
      same = previous && account && previous.generation === account.generation;
    var copy = Object.assign({}, self.data, { account: account });
    if (!same) {
      copy.queue = [];
      copy.completed = [];
      copy.groups = {};
      copy.phoneJobs = [];
      if (self.phone) self.phone.revoke();
      copy.folder = null;
      copy.settings = Object.assign({}, copy.settings, { autoUpload: false });
    }
    await self.store.save(copy);
    self.data = copy;
    self.quotaAt = 0;
    self.verifiedThisRun.clear();
    return async function () {
      await self.store.save(snapshot);
      self.data = snapshot;
      self.google.account = snapshot.account;
      self.quotaAt = 0;
      self.verifiedThisRun.clear();
    };
  };
  return this;
};
RemoteBackup.prototype.save = function () {
  return this.store.save(this.data);
};
RemoteBackup.prototype.clearRate = function () {
  this.view.activeClipId = null;
  this.view.etaSeconds = null;
  this.view.bytesPerSecond = null;
  this.view.drives.forEach(function (d) {
    if (/^(Uploading|Verifying)$/.test(d.state)) d.state = "Paused";
  });
  this.started = 0;
  this.sent = 0;
};
RemoteBackup.prototype.cancel = function () {
  this.clearRate();
  this.cancelGeneration++;
  if (this.google.transport && this.google.transport.cancel)
    this.google.transport.cancel();
  this.sessions.clear();
  if (this.phone) this.phone.revoke();
  this.clipReaders.forEach(function (release) {
    release();
  });
  this.clipReaders.clear();
};
RemoteBackup.prototype.command = async function (command, network) {
  if (
    !command ||
    typeof command.id !== "string" ||
    !/^[A-Za-z0-9-]{1,64}$/.test(command.id) ||
    command.id === this.data.lastCommandId ||
    command.id === this.lastCommand
  )
    return;
  this.lastCommand = command.id;
  this.data.lastCommandId = command.id;
  await this.save();
  if (command.action === "setup") {
    if (!network || !network.eligible)
      throw Error("Connect car to Wi-Fi to begin setup");
    this.cancel();
    this.data.settings.serviceId = null;
    await this.save();
    await this.google.beginSetup();
    this.view.state = "Enter the Google sign-in code";
  } else if (command.action === "cancel-setup") {
    await this.google.cancelSetup();
  } else if (command.action === "disconnect") {
    this.cancel();
    await this.google.disconnect();
  } else if (command.action === "settings") {
    if (!this.data.account) throw Error("Set up Remote Backup first");
    var s = this.data.settings;
    if (typeof command.autoUpload === "boolean") {
      s.autoUpload = command.autoUpload;
      if (!s.autoUpload) this.cancel();
    }
    if (typeof command.pauseRecording === "boolean" && s.autoUpload)
      s.pauseRecording = command.pauseRecording;
    if (typeof command.doNotBackupWhileDriving === "boolean")
      s.doNotBackupWhileDriving = command.doNotBackupWhileDriving;
    if (typeof command.onlyLockedDrives === "boolean") {
      s.onlyLockedDrives = command.onlyLockedDrives;
      this.cancel();
      this.scanAt = 0;
    }
    await this.save();
  } else if (command.action === "retry") {
    this.retryAt = 0;
    this.quotaAt = 0;
  }
};
var BACKUP_PHASES = {
  "Setup Remote Backup": "setup",
  "Enter the Google sign-in code": "sign-in",
  "Waiting for Google sign-in": "sign-in",
  "Google Drive connected": "connected",
  "Remote backup off": "off",
  "Waiting for USB": "waiting-for-usb",
  "Phone upload active": "phone-upload",
  "Phone connected; car backup paused": "phone-connected",
  "Preparing": "preparing",
  "Queued": "queued",
  "Uploading": "uploading",
  "Verifying": "verifying",
  "Paused": "paused",
  "Up to date": "up-to-date",
  "Waiting for drive to finish": "waiting-for-recording",
  "Missing recording dependency": "missing-dependency",
  "Reconnect Google Drive": "auth-required"
};
function backupPhase(state) {
  return Object.prototype.hasOwnProperty.call(BACKUP_PHASES, state) ? BACKUP_PHASES[state] : "other";
}
function backupErrorCode(code) {
  return ["storage-full", "auth-required", "rate-limit", "cancelled", "ETIMEDOUT",
    "ECONNRESET", "ENETUNREACH", "ENOENT", "EIO"].indexOf(code) !== -1 ? code : "retry";
}
RemoteBackup.prototype.status = function () {
  var s = (this.data && this.data.settings) || {},
    a = this.data && this.data.account;
  return Object.assign({}, this.view, {
    drives: this.view.drives
      .filter(function (d) {
        return d.state !== "Complete";
      })
      .concat(
        this.view.drives
          .filter(function (d) {
            return d.state === "Complete";
          })
          .slice(-5),
      )
      .slice(0, 50),
    diagnosticPhase: backupPhase(this.view.state),
    diagnosticErrorCode: this.now() < this.retryAt
      ? backupErrorCode(this.lastErrorCode)
      : null,
    configured: !!a,
    account: a ? a.label || "Google Drive" : null,
    autoUpload: !!s.autoUpload,
    pauseRecording: !!s.pauseRecording,
    doNotBackupWhileDriving: s.doNotBackupWhileDriving === true,
    onlyLockedDrives: !!s.onlyLockedDrives,
    setup: this.google.setupStatus(),
    completed: this.data ? this.data.completed.slice(0, 5) : [],
    pending: !!this.view.pending,
    wifi: (this.lastContext && this.lastContext.network) || { eligible: false },
  });
};
RemoteBackup.prototype.check = async function (context, generation, fd, metadataOnly) {
  if (context.viewerConnected && context.viewerConnected()) throw Error("Phone connected; car backup paused");
  if (context.uploadPermitted && context.uploadPermitted() !== true)
    throw Error("Waiting until the car is stationary");
  if (
    this.closed ||
    generation !== this.cancelGeneration ||
    context !== this.lastContext
  )
    throw Error("Backup cancelled");
  if (
    !context.network ||
    !context.network.eligible
  )
    throw Error("Waiting for permitted Wi-Fi");
  await context.guard.check(fd);
  if (context.viewerConnected && context.viewerConnected()) throw Error("Phone connected; car backup paused");
  if (context.uploadPermitted && context.uploadPermitted() !== true)
    throw Error("Waiting until the car is stationary");
  if (this.closed || generation !== this.cancelGeneration || context !== this.lastContext)
    throw Error("Backup cancelled");
  var recording = context.readRecording ? context.readRecording() : context.recording;
  // Small transient buffers are normal during capture. Yield only when the
  // recorder has a genuine backlog; refresh the snapshot before each I/O.
  if (!metadataOnly && recording &&
      (recording.finalizing || recording.metrics && recording.metrics.queuedBytes > 4 * 1024 * 1024))
    throw Error("Recording takes priority");
};
RemoteBackup.prototype.hash = async function (file, context, generation) {
  var st = await io.safePath(file, "file"),
    sig = signature(st),
    cached = this.hashes.get(file);
  if (cached && cached.signature === sig) return cached;
  var fd = await io.open(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    ),
    hash = crypto.createHash("md5");
  try {
    for (var at = 0; at < st.size; at += CHUNK) {
      await this.check(context, generation, fd);
      var b = await io.readAt(fd, Math.min(CHUNK, st.size - at), at);
      if (!b.length) throw Error("USB source changed");
      hash.update(b);
      await new Promise(function (r) {
        setTimeout(r, 0);
      });
    }
    if (signature(await io.fstat(fd)) !== sig)
      throw Error("USB source changed");
  } finally {
    await io.close(fd);
  }
  var value = { signature: sig, size: st.size, md5: hash.digest("hex") };
  this.hashes.set(file, value);
  return value;
};
RemoteBackup.prototype.folder = async function (
  holder,
  name,
  parent,
  context,
  generation,
) {
  if (!holder.id) {
    holder.id = await this.google.allocateId();
    await this.save();
  }
  if (!holder.created) {
    await this.check(context, generation);
    try {
      await this.google.createFolder(holder.id, name, parent);
    } catch (e) {
      if (e.code !== "exists") throw e;
      var remote = await this.google.inspectFile(holder.id);
      if (
        remote.mimeType !== "application/vnd.google-apps.folder" ||
        remote.trashed
      )
        throw Error("Remote backup folder unavailable");
    }
    holder.created = true;
    await this.save();
  }
  return holder.id;
};
RemoteBackup.prototype.tick = async function (context) {
  if (this.busy || this.closed || !this.data) return;
  this.busy = true;
  this.lastContext = context;
  var generation = this.cancelGeneration,
    self = this;
  try {
    if (context.viewerConnected && context.viewerConnected() && !(this.phone && this.phone.live())) {
      this.clearRate();this.view.state="Phone connected; car backup paused";return;
    }
    if (this.google.setupStatus()) {
      this.clearRate();
      this.view.state = "Waiting for Google sign-in";
      if (context.network && context.network.eligible) {
        var connected = await this.google.pollSetup();
        if (connected) {
          this.quotaAt = 0;
          this.view.state = "Google Drive connected";
        }
      }
      return;
    }
    if (!this.data.account) {
      this.clearRate();
      this.view.pending = false;
      this.view.storageFull = false;
      this.view.state = "Setup Remote Backup";
      return;
    }
    var manualPending = this.data.queue.some(function(r) { return r.manual && !r.excluded && !r.done; }) || this.phone && this.phone.live();
    if (!this.data.settings.autoUpload && !manualPending) {
      this.clearRate();
      this.view.pending = false;
      this.view.storageFull = false;
      this.view.state = "Remote backup off";
      return;
    }
    if (!context.library || !context.guard) {
      this.clearRate();
      this.hashes.clear();
      this.verifiedThisRun.clear();
      this.view.state = "Waiting for USB";
      return;
    }
    if (this.phone && this.phone.live()) {
      this.clearRate(); this.view.pending = true; this.view.state = "Phone upload active"; return;
    }
    if (context.viewerConnected && context.viewerConnected()) {
      this.clearRate();this.view.state="Phone connected; car backup paused";return;
    }
    await this.check(context, generation, null, true);
    if (this.phone) await this.phone.adopt(context);
    if (
      this.scanLibrary !== context.library ||
      this.sourceIdentity !== context.guard.identity ||
      this.sourceGuard !== context.guard
    ) {
      this.hashes.clear();
      this.verifiedThisRun.clear();
      this.sourceIdentity = context.guard.identity;
      this.sourceGuard = context.guard;
    }
    var scan =
      this.scanLibrary !== context.library ||
      this.scanRevision !== context.library.summaryRevision ||
      this.now() >= this.scanAt;
    if (scan) {
      var revision = context.library.summaryRevision;
      this.manifests = await context.library.backupManifests();
      this.scanRevision = revision;
      this.scanLibrary = context.library;
      this.scanAt = this.now() + 3000;
    }
    var manifests = this.manifests,
      drives = group(manifests),
      byId = new Map();
    manifests.forEach(function (m) {
      byId.set(m.id, m);
    });
    var manualIds = new Set(this.data.queue.filter(function(r) { return r.manual && !r.excluded && r.source === context.guard.identity; }).map(function(r) { return r.clipId; }));
    if (!this.data.settings.autoUpload) drives = drives.map(function(d) { return Object.assign({},d,{clips:d.clips.filter(function(m) { return manualIds.has(m.id); })}); }).filter(function(d) { return d.clips.length; });
    if (this.data.settings.onlyLockedDrives)
      drives = drives.map(function (d) {
        if (d.clips.every(function (m) { return m.locked === true; })) return d;
        var clips = d.clips.filter(function (m) {
          return manualIds.has(m.id) || m.locked === true && Number.isSafeInteger(m.hornLockRevision) && m.hornLockRevision > 0;
        });
        return Object.assign({}, d, {clips: clips, hornOnly: true,
          bytes: clips.reduce(function (n, m) { return n + (Number(m.bytes) || 0); }, 0)});
      }).filter(function (d) { return d.clips.length > 0; });
    var excludedIds = new Set(this.data.queue.filter(function(r) { return r.excluded && r.source === context.guard.identity; }).map(function(r) { return r.clipId; }));
    drives = drives.map(function(d) { return Object.assign({},d,{clips:d.clips.filter(function(m) { return !excludedIds.has(m.id); })}); }).filter(function(d) { return d.clips.length; });
    var receipts = this.data.queue;
    // Publish discovered work before yielding to capture. This keeps the UI
    // informative and lets an eligible automatic pause drain the writer queue.
    var oldViews = this.view.drives;
    this.view.drives = drives.map(function (drive) {
      var bytes = 0, confirmed = 0, verified = 0;
      drive.clips.forEach(function (m) {
        var receipt = receipts.filter(function (r) { return r.clipId === m.id && r.source === context.guard.identity; })[0];
        if (receipt) {
          bytes += receipt.files.reduce(function (n, f) { return n + f.size; }, 0);
          confirmed += receipt.files.reduce(function (n, f) { return n + (f.done ? f.size : f.offset || 0); }, 0);
          if (receipt.done && self.verifiedThisRun.has(m.id)) verified++;
        } else bytes += Number(m.bytes) || 0;
      });
      var old = oldViews.filter(function (v) { return v.id === drive.id; })[0];
      var complete = old && old.state === "Complete" && verified === drive.clips.length && old.totalClips === drive.clips.length;
      return {id:drive.id,startedAt:drive.startedAt,totalClips:drive.clips.length,verifiedClips:verified,bytes:bytes,confirmedBytes:confirmed,progress:bytes?Math.min(complete?1:0.999,confirmed/bytes):0,state:complete?"Complete":old&&/^(Uploading|Verifying)$/.test(old.state)?old.state:"Queued"};
    });
    this.view.remainingDrives = this.view.drives.filter(function (v) { return v.state !== "Complete"; }).length;
    this.view.remainingBytes = this.view.drives.reduce(function (n, v) { return n + Math.max(0, v.bytes - v.confirmedBytes); }, 0);
    this.view.pending = this.view.drives.some(function (v) { return v.verifiedClips < v.totalClips; });
    if (this.view.pending && !/^(Uploading|Verifying)$/.test(this.view.state)) this.view.state = "Preparing";
    await this.check(context, generation);
    // Revalidate source contents after each mount/restart before trusting durable receipts.
    for (var ri = 0; ri < receipts.length; ri++) {
      var receipt = receipts[ri];
      if (
        !receipt.done ||
        receipt.source !== context.guard.identity ||
        !byId.has(receipt.clipId) ||
        (!scan && this.verifiedThisRun.has(receipt.clipId))
      )
        continue;
      var releaseVerify = await context.library.acquire(receipt.clipId);
      this.clipReaders.add(releaseVerify);
      try {
        var bundle = await context.library.bundle(receipt.clipId);
        if (bundle.length !== receipt.files.length) receipt.done = false;
        for (var bi = 0; bi < bundle.length && receipt.done; bi++) {
          var savedFile = receipt.files.filter(function (f) {
            return f.name === bundle[bi].name;
          })[0];
          var local = await this.hash(bundle[bi].path, context, generation);
          if (
            !savedFile ||
            local.md5 !== savedFile.md5 ||
            local.size !== savedFile.size
          )
            receipt.done = false;
          else savedFile.signature = local.signature;
        }
        if (receipt.done) this.verifiedThisRun.add(receipt.clipId);
        else this.verifiedThisRun.delete(receipt.clipId);
      } finally {
        this.clipReaders.delete(releaseVerify);
        releaseVerify();
      }
    }
    function dependencyReady(id, seen) {
      if (seen.has(id)) return false;
      var m = byId.get(id);
      if (!m) return false;
      seen.add(id);
      if (!m.requiresPrevious) return true;
      if (!m.previousId || !self.verifiedThisRun.has(m.previousId))
        return false;
      return dependencyReady(m.previousId, seen);
    }
    var selected = null,
      selectedDrive = null,
      allViews = [],
      changed = false;
    for (var di = 0; di < drives.length; di++) {
      var drive = drives[di],
        membership = drive.clips
          .map(function (m) {
            return m.id;
          })
          .join(","),
        tracked = this.data.groups[drive.id];
      if (!tracked || tracked.membership !== membership) {
        tracked = { membership: membership, changedAt: this.now() };
        this.data.groups[drive.id] = tracked;
        changed = true;
      }
      var verified = 0,
        confirmed = 0,
        bytes = 0,
        dependency = false;
      for (var ci = 0; ci < drive.clips.length; ci++) {
        var m = drive.clips[ci];
        if (!dependencyReady(m.id, new Set())) dependency = true;
        var rec = receipts.filter(function (r) {
          return r.clipId === m.id && r.source === context.guard.identity;
        })[0];
        if (rec && rec.done) verified++;
        if (rec) {
          bytes += rec.files.reduce(function (n, f) {
            return n + f.size;
          }, 0);
          confirmed += rec.files.reduce(function (n, f) {
            return n + (f.done ? f.size : f.offset || 0);
          }, 0);
        } else bytes += Number(m.bytes) || 0;
        if (
          !selected &&
          !(rec && rec.done) &&
          dependencyReady(m.id, new Set())
        ) {
          selected = m;
          selectedDrive = drive;
        }
      }
      var end = drive.clips[drive.clips.length - 1],
        ended = Date.parse(end.startedAt) + end.durationSeconds * 1000,
        closed =
          !context.recording.activeId &&
          ((isFinite(ended) && this.now() - ended > 300000) ||
            this.now() - tracked.changedAt > 300000);
      var complete = verified === drive.clips.length && closed && !dependency,
        previousDrive = oldViews.filter(function (v) { return v.id === drive.id; })[0],
        view = {
          id: drive.id,
          startedAt: drive.startedAt,
          verifiedClips: verified,
          totalClips: drive.clips.length,
          bytes: bytes,
          confirmedBytes: confirmed,
          progress: bytes
            ? Math.min(complete ? 1 : 0.999, confirmed / bytes)
            : 0,
          state: dependency
            ? "Missing recording dependency"
            : complete
              ? "Complete"
              : verified === drive.clips.length
                ? "Waiting for drive to finish"
                : previousDrive && /^(Uploading|Verifying)$/.test(previousDrive.state)
                  ? previousDrive.state
                  : "Queued",
        };
      allViews.push(view);
      // Remove stale completions when a group grows or changes, including merged groups.
      var before = this.data.completed.length;
      this.data.completed = this.data.completed.filter(function (log) {
        return (
          !log.clipIds.some(function (id) {
            return drive.clips.some(function (c) {
              return c.id === id;
            });
          }) ||
          (complete && log.membership === membership)
        );
      });
      if (before !== this.data.completed.length) changed = true;
      if (complete && tracked.completedMembership !== membership) {
        tracked.completedMembership = membership;
        this.data.completed.unshift({
          id: drive.id,
          membership: membership,
          clipIds: drive.clips.map(function (c) {
            return c.id;
          }),
          startedAt: drive.startedAt,
          completedAt: new Date(this.now()).toISOString(),
        });
        this.data.completed = this.data.completed.slice(0, 5);
        changed = true;
      }
      if (!complete && tracked.completedMembership) {
        delete tracked.completedMembership;
        changed = true;
      }
      if (dependency) {
        view.progress = 0;
      }
    }
    allViews.forEach(function (d) {
      if ((!selectedDrive || d.id !== selectedDrive.id) && /^(Uploading|Verifying)$/.test(d.state)) d.state = "Queued";
    });
    this.view.drives = allViews;
    this.view.remainingDrives = allViews.filter(function (d) {
      return d.state !== "Complete";
    }).length;
    this.view.remainingBytes = allViews.reduce(function (n, d) {
      return n + Math.max(0, d.bytes - d.confirmedBytes);
    }, 0);
    if (changed) await this.save();
    this.view.pending = !!selected;
    if (!selected) {
      this.clearRate();
      this.view.state = allViews.some(function (d) {
        return /dependency/.test(d.state);
      })
        ? "Missing recording dependency"
        : this.view.remainingDrives
          ? "Waiting for drive to finish"
          : "Up to date";
      return;
    }
    if (this.now() < this.retryAt) {
      this.view.state = this.lastError || "Retrying backup";
      if (this.lastErrorCode === "storage-full") this.view.storageFull = true;
      return;
    }
    if (!this.quota || this.now() >= this.quotaAt) {
      this.quota = await this.google.about();
      this.quotaAt = this.now() + 60000;
      if (this.quota.email && this.data.account.email !== this.quota.email) {
        this.data.account.email = this.quota.email;
        await this.save();
      }
      if (this.quota.label && this.data.account.label !== this.quota.label) {
        this.data.account.label = this.quota.label;
        this.google.account = this.data.account;
        await this.save();
      }
    }
    if (
      this.quota.limit !== null &&
      Number.isFinite(this.quota.usage) &&
      this.quota.limit - this.quota.usage <= 0
    ) {
      var full = Error("REMOTE BACKUP PAUSED -  REMOTE STORAGE FULL");
      full.code = "storage-full";
      throw full;
    }
    this.view.storageFull = false;
    this.view.activeClipId = selected.id;
    var selectedManual = manualIds.has(selected.id);
    var release = this.data.settings.onlyLockedDrives && !selectedManual
      ? await context.library.acquireRecordings(
          selectedDrive.clips.map(function (m) {
            return m.id;
          }),
        )
      : await context.library.acquire(selected.id);
    this.clipReaders.add(release);
    try {
      if (this.data.settings.onlyLockedDrives && !selectedManual) {
        for (var li = 0; li < selectedDrive.clips.length; li++) {
          if (manualIds.has(selectedDrive.clips[li].id)) continue;
          var fresh = await context.library.manifest(selectedDrive.clips[li].id);
          if (fresh.locked !== true || selectedDrive.hornOnly &&
              (!Number.isSafeInteger(fresh.hornLockRevision) || fresh.hornLockRevision <= 0)) {
            this.scanAt = 0;
            throw Error("Selected recording is no longer protected");
          }
        }
      }
      var sourceFiles = await context.library.bundle(selected.id),
        prepared = [];
      for (var fi = 0; fi < sourceFiles.length; fi++) {
        var source = sourceFiles[fi],
          info = await this.hash(source.path, context, generation);
        prepared.push(
          Object.assign({ name: source.name, path: source.path }, info),
        );
      }
      var record = receipts.filter(function (r) {
        return r.clipId === selected.id && r.source === context.guard.identity;
      })[0];
      var recordChanged = false;
      if (!record) {
        recordChanged = true;
        record = {
          clipId: selected.id,
          source: context.guard.identity,
          files: [],
          folder: {},
        };
        receipts.push(record);
      }
      prepared.forEach(function (p) {
        var old = record.files.filter(function (f) {
          return f.name === p.name && f.md5 === p.md5 && f.size === p.size;
        })[0];
        if (old) {
          if (old.signature !== p.signature) recordChanged = true;
          old.signature = p.signature;
          old.path = p.path;
        } else {
          recordChanged = true;
          var prior = record.files.filter(function (f) {
            return f.name === p.name;
          })[0];
          if (prior && p.name === "capture.bvr" && prior.md5 !== p.md5)
            throw Error("USB recording changed; previous cloud copy preserved");
          if (prior && prior.remoteId) {
            p.remoteId = prior.remoteId;
            p.replacing = true;
            self.sessions.delete(prior.remoteId);
          }
          record.files = record.files
            .filter(function (f) {
              return f.name !== p.name;
            })
            .concat([Object.assign({}, p, { offset: 0, done: false })]);
        }
      });
      record.files = record.files.filter(function (f) {
        return prepared.some(function (p) {
          return p.name === f.name;
        });
      });
      record.done = false;
      if (recordChanged) await this.save();
      this.data.folder = this.data.folder || {};
      var parent = await this.folder(
          record.root || this.data.folder,
          "BimmerVision",
          null,
          context,
          generation,
        ),
        clipFolder = await this.folder(
          record.folder,
          selected.id,
          parent,
          context,
          generation,
        ),
        file = record.files.filter(function (f) {
          return !f.done;
        })[0];
      if (!file) {
        record.done = true;
        await this.save();
        return;
      }
      file.key =
        this.data.account.generation +
        ":" +
        selected.id +
        ":" +
        file.name +
        ":" +
        file.md5;
      file.parent = clipFolder;
      if (!file.remoteId) {
        file.remoteId = await this.google.allocateId();
        await this.save();
      }
      var existing = null;
      if (!this.sessions.has(file.remoteId)) {
        try {
          existing = await this.google.inspectFile(file.remoteId);
        } catch (e) {
          if (e.code !== "not-found") throw e;
        }
      }
      if (
        existing &&
        Number(existing.size) === file.size &&
        existing.md5Checksum === file.md5 &&
        !existing.trashed
      ) {
        file.done = true;
        file.offset = file.size;
        await this.save();
        return;
      }
      if (!file.session) {
        try {
          file.session = await this.google.beginUpload(file);
        } catch (e) {
          if (e.code === "exists")
            throw Error("Remote recording checksum mismatch");
          throw e;
        }
        await this.save();
      }
      var upload;
      try {
        upload = this.sessions.has(file.remoteId)
          ? { offset: file.offset, complete: false }
          : await this.google.queryUpload(file.session, file.size);
        this.sessions.add(file.remoteId);
      } catch (e) {
        if (e.code === "not-found") {
          file.session = null;
          file.offset = 0;
          await this.save();
          return;
        }
        throw e;
      }
      file.offset = upload.offset;
      if (!upload.complete) {
        await this.check(context, generation);
        var fd = await io.open(
            file.path,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
          ),
          chunk;
        try {
          await this.check(context, generation, fd);
          if (signature(await io.fstat(fd)) !== file.signature)
            throw Error("USB source changed");
          chunk = await io.readAt(
            fd,
            Math.min(this.uploadChunkBytes, file.size - file.offset),
            file.offset,
          );
          if (!chunk.length) throw Error("USB source changed");
          await this.check(context, generation, fd);
        } finally {
          await io.close(fd);
        }
        await this.check(context, generation);
        this.view.state = "Uploading";
        allViews.filter(function (d) {
          return d.id === selectedDrive.id;
        })[0].state = "Uploading";
        var uploadStartedAt = this.now(), requestedBytes = this.uploadChunkBytes;
        upload = await this.google.uploadChunk(
          file.session,
          file.offset,
          chunk,
          file.size,
        );
        file.offset = upload.offset;
        var requestMs = Math.max(0, this.now() - uploadStartedAt);
        if (chunk.length === requestedBytes && requestMs < 8000)
          this.uploadChunkBytes = Math.min(this.maxUploadChunkBytes, requestedBytes * 2);
        else if (requestMs > 15000)
          this.uploadChunkBytes = Math.max(CHUNK, requestedBytes / 2);
        this.sent += chunk.length;
        if (!this.started) this.started = this.now();
        var elapsed = (this.now() - this.started) / 1000;
        this.view.bytesPerSecond = elapsed > 2 ? this.sent / elapsed : null;
        this.view.etaSeconds = this.view.bytesPerSecond
          ? Math.ceil(this.view.remainingBytes / this.view.bytesPerSecond)
          : null;
      }
      if (upload.complete) {
        this.view.state = "Verifying";
        var verifiedFile = await this.google.inspectFile(file.remoteId);
        if (
          verifiedFile.trashed ||
          Number(verifiedFile.size) !== file.size ||
          verifiedFile.md5Checksum !== file.md5
        )
          throw Error("Remote recording checksum mismatch");
        file.done = true;
        file.offset = file.size;
      }
      record.done = record.files.every(function (f) {
        return f.done;
      });
      await this.check(context, generation);
      if (
        file.done ||
        !file.savedOffset ||
        file.offset - file.savedOffset >= 8 * CHUNK
      ) {
        file.savedOffset = file.offset;
        await this.save();
      }
      this.lastError = null;
      this.lastErrorCode = null;
    } finally {
      this.clipReaders.delete(release);
      release();
    }
  } catch (e) {
    if (e.code === "ETIMEDOUT" || /\(28\)|timed?\s*out|timeout/i.test(e.message))
      this.uploadChunkBytes = Math.max(CHUNK, this.uploadChunkBytes / 2);
    if (/USB|mount|Volume|descriptor/i.test(e.message)) {
      this.hashes.clear();
      this.verifiedThisRun.clear();
    }
    this.sessions.clear();
    this.view.state =
      /^Recording changed after phone selection/.test(e.message)
        ? e.message
        : e.code === "storage-full"
        ? e.message
        : e.code === "auth-required"
          ? "Reconnect Google Drive"
          : /USB|mount|Volume|descriptor/i.test(e.message)
            ? "Waiting for USB"
            : /Wi-Fi|Phone connected|Recording takes priority|cancelled|stationary/.test(e.message)
              ? e.message
              : "Remote backup paused; retrying";
    if (e.code === "storage-full") this.view.storageFull = true;
    this.lastError = this.view.state;
    this.lastErrorCode = e.code;
    this.retryAt =
      this.now() +
      (e.code === "storage-full"
        ? 60000
        : e.code === "rate-limit"
          ? 30000
          : 3000);
    if (e.code === "storage-full") this.quotaAt = 0;
    this.clearRate();
  } finally {
    this.busy = false;
  }
};
RemoteBackup.prototype.close = function () {
  this.closed = true;
  this.cancel();
};
module.exports = { RemoteBackup: RemoteBackup };
