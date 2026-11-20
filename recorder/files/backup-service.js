"use strict";
var fs = require("fs"),
  path = require("path"),
  State = require("./backup-state").State,
  NetworkGate = require("./backup-network").NetworkGate,
  Transport = require("./backup-http").Transport,
  GoogleDrive = require("./google-drive").GoogleDrive,
  RemoteBackup = require("./remote-backup").RemoteBackup;
// Packaged native device identity is deliberately limited to two fields. User
// tokens, account information and web/server client exports are never accepted.
function validateDeviceClient(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && value.installed) value = value.installed;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 ||
      Object.keys(value).some(function (key) { return key !== "client_id" && key !== "client_secret"; }) ||
      typeof value.client_id !== "string" || !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(value.client_id) ||
      typeof value.client_secret !== "string" || !/^GOCSPX-[A-Za-z0-9_-]{20,128}$/.test(value.client_secret))
    throw Error("Invalid packaged Google device client configuration");
  return {client_id: value.client_id, client_secret: value.client_secret};
}
function BackupService(options) {
  this.options = options || {};
  this.network = this.options.network || new NetworkGate();
  var self = this;
  this.transport = this.options.transport || new Transport({
    network: this.network,
    requestPermitted: function () { return !self.viewerConnected(); },
    uploadPermitted: function () { return self.uploadAllowed() && !self.viewerConnected(); }
  });
  this.closed = false;
  this.timer = null;
  this.speedTimer = null;
  this.lastUploadPermission = null;
  this.uploadGranted = false;
  this.worker = null;
  this.wifi = { eligible: false };
  this.busy = null;
  this.commands = Promise.resolve();
  this.phoneMutation = null;
  this.mutations = 0;
  this.message = "";
}
BackupService.prototype.init = async function () {
  var self = this, o = this.options,
    client = o.client || {};
  if (!o.client) {
    var useBundled = true;
    if (o.clientFile) {
      try {
        var st = fs.lstatSync(o.clientFile);
        useBundled = false;
        if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 63) !== 0 || st.size > 16384)
          throw Error("Unsafe Google client configuration");
        var value = JSON.parse(fs.readFileSync(o.clientFile, "utf8"));
        client = value.installed || value;
      } catch (e) {
        useBundled = e.code === "ENOENT";
        if (!useBundled) this.message = "Google client configuration unavailable";
      }
    }
    if (useBundled) {
      try {
        var bundled = o.bundledClientFile || path.join(__dirname, "google-device-client.json"), packaged = fs.lstatSync(bundled);
        if (!packaged.isFile() || packaged.isSymbolicLink() || (packaged.mode & 18) !== 0 || packaged.size > 16384)
          throw Error("Unsafe packaged Google client configuration");
        client = validateDeviceClient(JSON.parse(fs.readFileSync(bundled, "utf8")));
      } catch (e) {
        if (e.code !== "ENOENT") this.message = "Google client configuration unavailable";
      }
    }
  }
  this.google = new GoogleDrive({ client: client, transport: this.transport });
  this.worker = new RemoteBackup({
    state: o.state || new State(o.directory),
    google: this.google,
    maxUploadChunkBytes: o.maxUploadChunkBytes,
  });
  await this.worker.init();
  this.phone = new (require("./phone-backup").PhoneBackup)({worker:this.worker,context:function(){return self.options.context();},permitted:function(){return self.uploadAllowed();}});
  this.worker.phone = this.phone;
  this.wifi = await this.network.snapshot();
  return this;
};
BackupService.prototype.status = function () {
  var status = Object.assign(
    {},
    this.worker
      ? this.worker.status()
      : {
          configured: false,
          autoUpload: false,
          pauseRecording: false,
          doNotBackupWhileDriving: false,
          drives: [],
          completed: [],
        },
    {
      wifi: this.wifi,
      message: this.message,
      phone: this.phone ? this.phone.status() : {available:false},
      speedPermitted: this.uploadAllowed(),
      stationaryPermitted: this.stationaryAllowed(),
      viewerConnected: this.viewerConnected(),
    },
  );
  if (status.phone && status.phone.active) {
    status.pending = true;
    status.state = "Phone upload active";
  }
  if (status.configured && (status.autoUpload || status.phone && (status.phone.active || status.phone.pending > 0)) && !status.storageFull && !status.speedPermitted) {
    status.state = "Waiting until the car is stationary";
    status.etaSeconds = null;
    status.bytesPerSecond = null;
  }
  return status;
};
BackupService.prototype.viewerConnected = function () {
  try { return !!this.options.viewerConnected && this.options.viewerConnected() === true; }
  catch(e) { return false; }
};
BackupService.prototype.stationaryAllowed = function () {
  try { return !!this.options.stationaryPermitted && this.options.stationaryPermitted() === true; }
  catch (e) { return false; }
};
BackupService.prototype.uploadAllowed = function () {
  var settings = this.worker && this.worker.data && this.worker.data.settings;
  if (!settings || settings.doNotBackupWhileDriving !== true) return true;
  return this.stationaryAllowed();
};
BackupService.prototype.sampleUploadPermission = function () {
  var viewer = this.viewerConnected();
  if (viewer && this.lastViewer !== true && !this.mutations && !(this.phone && this.phone.live()) && this.worker) {
    this.worker.cancel();
    if (this.transport.cancel) this.transport.cancel();
  }
  this.lastViewer = viewer;
  var allowed = this.uploadAllowed();
  if (!allowed && (this.lastUploadPermission === true || this.uploadGranted || this.transport.active && this.transport.active.size > 0)) {
    this.cancel();
    this.uploadGranted = false;
  }
  if (this.lastUploadPermission === false && allowed && this.worker) this.worker.retryAt = 0;
  this.lastUploadPermission = allowed;
};
BackupService.prototype.command = function (value) {
  var self = this, phoneMutation = this.phoneMutation, queueMutation = this.queueMutation;
  if (!value) return Promise.resolve();
  var next = this.commands.then(async function () {
    if (phoneMutation) await phoneMutation;
    if (queueMutation) await queueMutation;
    if (self.closed) return;
    self.wifi = await self.network.snapshot();
    try {
      await self.worker.command(value, self.wifi);
      self.message = "";
    } catch (e) {
      self.message = /Wi-Fi|Set up|credentials/.test(e.message)
        ? e.message
        : "Remote backup command could not be completed";
    }
  });
  this.commands = next.catch(function () {});
  return next;
};
BackupService.prototype.queueRequest = function (body, mutate) {
  if (!this.queue) this.queue = new (require("./backup-queue").Queue)(this);
  return mutate ? this.queue.change(body) : this.queue.status();
};
BackupService.prototype.phoneRequest = async function(action, jobId, body) {
  if (!this.phone) throw Error("Phone backup unavailable");
  if (action === "status") {
    if (this.queueMutation) await this.queueMutation;
    if (this.closed) throw Error("Remote backup closed");
    if (this.worker.data.account && !this.worker.data.account.email && !this.mutations) {
      var finishStatus;
      var statusMutation = new Promise(function(resolve) { finishStatus = resolve; });
      this.phoneMutation = statusMutation;
      this.mutations++;
      try {
        if (this.busy) await this.busy;
        this.wifi = await this.network.snapshot();
        if (this.wifi.eligible) {
          var generation = this.worker.data.account && this.worker.data.account.generation;
          var identity = await this.google.about();
          if (identity.email && this.worker.data.account && this.worker.data.account.generation === generation) {
            this.worker.data.account.email = identity.email;
            await this.worker.save();
          }
        }
      } catch (e) { /* Keep a useful offline status; the transport still denies cellular. */ }
      finally {this.mutations--; if (this.phoneMutation === statusMutation) this.phoneMutation = null; finishStatus();}
    }
    return this.phone.status();
  }
  if (["claim","enqueue","heartbeat","release","register","read"].indexOf(action) < 0) throw Error("Unknown phone backup action");
  if (action === "register") {
    if (this.mutations > (this.queueEditing || 0)) throw Error("A backup or library change is already active");
    var previousQueue = this.queueMutation, finishRegister;
    var registerMutation = new Promise(function(resolve) { finishRegister = resolve; });
    this.phoneMutation = registerMutation; this.mutations++;
    try {
      if (previousQueue) await previousQueue;
      if (this.closed) throw Error("Remote backup closed");
      return await this.phone.register(jobId, body);
    } finally {this.mutations--; if(this.phoneMutation === registerMutation) this.phoneMutation = null; finishRegister();}
  }
  if (action !== "claim" && action !== "enqueue") return this.phone[action](jobId, body);
  if (this.queueEditing && this.queueMutation) await this.queueMutation;
  var self = this, commands = this.commands, queueMutation = this.queueMutation, finishMutation;
  if (this.mutations || this.phone.live()) throw Error("A phone upload or library change is already active");
  this.phoneMutation = new Promise(function (resolve) { finishMutation = resolve; });
  this.mutations++; this.cancel();
  try {
    if (this.busy) await this.busy;
    await commands;
    if (queueMutation) await queueMutation;
    this.wifi = await this.network.snapshot();
    if (!this.worker.data.account || !this.worker.data.account.email) {
      if (!this.wifi.eligible) throw Error("Connect car to Wi-Fi once to verify the linked Google account");
      var info = await this.google.about();
      if (info.email && this.worker.data.account) {this.worker.data.account.email=info.email;await this.worker.save();}
    }
    return await self.phone[action](body);
  } finally {this.mutations--; this.phoneMutation = null; finishMutation();}
};
BackupService.prototype.context = function () {
  var self = this, c = this.options.context();
  c.network = this.wifi;
  c.viewerConnected = function () { return self.viewerConnected(); };
  c.uploadPermitted = function () {
    var allowed = self.uploadAllowed();
    if (allowed) self.uploadGranted = true;
    return allowed;
  };
  return c;
};
BackupService.prototype.tick = async function () {
  if (this.closed || this.busy || this.mutations) return;
  var self = this;
  this.busy = (async function () {
    self.wifi = await self.network.snapshot();
    await self.worker.tick(self.context());
  })().catch(function () {
    self.message = "Remote backup unavailable; local recording unchanged";
  });
  try {
    await this.busy;
  } finally {
    this.busy = null;
  }
};
BackupService.prototype.withLibraryMutation = async function (fn) {
  var phoneMutation = this.phoneMutation;
  this.mutations++;
  try {
    if (phoneMutation) await phoneMutation;
    this.cancel();
    if (this.busy) await this.busy;
    return await fn();
  } finally {
    if (this.worker) {
      this.worker.scanAt = 0;
      this.worker.hashes.clear();
      this.worker.verifiedThisRun.clear();
      this.worker.retryAt = 0;
    }
    this.mutations--;
  }
};
BackupService.prototype.start = function () {
  var self = this;
  this.sampleUploadPermission();
  this.speedTimer = setInterval(function () { self.sampleUploadPermission(); }, 250);
  if (this.speedTimer.unref) this.speedTimer.unref();
  async function loop() {
    if (self.closed) return;
    await self.tick();
    if (!self.closed) {
      var s = self.status();
      self.timer = setTimeout(
        loop,
        s.pending && /^Uploading|Verifying$/.test(s.state) ? 20 : 1000,
      );
      if (self.timer.unref) self.timer.unref();
    }
  }
  loop();
};
BackupService.prototype.cancel = function () {
  if (this.worker) this.worker.cancel();
  if (this.transport.cancel) this.transport.cancel();
};
BackupService.prototype.close = async function () {
  this.closed = true;
  clearTimeout(this.timer);
  clearInterval(this.speedTimer);
  this.cancel();
  if (this.worker) this.worker.close();
  this.transport.close();
  this.network.close();
  if (this.busy) await this.busy;
  await this.commands;
  if (this.queueMutation) await this.queueMutation;
  if (this.phoneMutation) await this.phoneMutation;
};
module.exports = { BackupService: BackupService, validateDeviceClient: validateDeviceClient };
