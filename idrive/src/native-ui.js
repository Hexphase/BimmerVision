"use strict";
var crypto = require("crypto"),
  fs = require("fs"),
  path = require("path"),
  qr = require("./qr");
var ROWS = [
  "HOME_ALL",
  "HOME_FRONT",
  "HOME_REAR",
  "HOME_LEFT",
  "HOME_RIGHT",
  "HOME_AUTO",
  "HOME_DELETE",
];
function UI(o) {
  this.rhmi = o.rhmi;
  this.onboarding = o.onboarding || null;
  this.noticeHandled = false;
  this.report = o.report || function(e){console.error(String(e.message||e));};
  this.recording = o.recording;
  this.display = o.display;
  this.entry = o.entry;
  this.page = "home";
  this.visible = false;
  this.closed = false;
  this.listeners = [];
  this.cache = {};
  this.rendering = null;
  this.renderAgain = false;
  this.visit = null;
  this.drivePage = 0;
  this.qrUrl = "";
  this.externalQr = false;
  this.preferExternalQr = o.preferExternalQr === true;
  this.message = "";
  this.nowMs = o.nowMs || Date.now;
  this.deleteNoticeId = null;
  this.deleteNoticeVolumeToken = null;
}
UI.prototype.clearDeleteNotice = function () {
  this.deleteNoticeId = null;
  this.deleteNoticeVolumeToken = null;
};
UI.prototype.component = function (n) {
  return this.rhmi.getByName(n);
};
UI.prototype.listen = function (em, event, fn) {
  if (em && em.on) {
    em.on(event, fn);
    this.listeners.push([em, event, fn]);
  }
};
UI.prototype.desk = function () {
  return this.recording
    ? this.recording.read()
    : { state: "Recorder unavailable", drives: [] };
};
UI.prototype.intent = function () {
  return this.recording ? this.recording.intent() : {};
};
UI.prototype.update = function (p) {
  if (this.recording) this.recording.update(p);
};
UI.prototype.revoke = function () {
  if (this.visit)
    this.update({
      transfer: { visit: this.visit, visible: false, heartbeat: Date.now() },
    });
  this.visit = null;
  this.qrUrl = "";
  this.externalQr = false;
  if (this.display) this.display.hide();
};
UI.prototype.beat = function () {
  if (this.visible && this.page === "connect" && this.visit && !this.closed)
    this.update({
      transfer: { visit: this.visit, visible: true, heartbeat: Date.now() },
    });
};
UI.prototype.text = async function (n, value) {
  var c = this.component(n);
  if (c && c.setValue && this.cache[n] !== String(value)) {
    await c.setValue(0, "Text", String(value), "Text");
    this.cache[n] = String(value);
  }
};
UI.prototype.initialize = async function () {
  var self = this;
  ROWS.forEach(function (row) {
    self.listen(self.component(row), "action", function () {
      Promise.resolve(
        row === "HOME_AUTO" ? self.back() : self.press(row)
      ).catch(function (e) {
        self.message = e.message;
      });
    });
  });
  this.listen(this.component("HOME"), "visible", function (e) {
    self.visible = !!(e && e.visible);
    if (!self.visible) {
      self.revoke();
      self.clearDeleteNotice();
      self.page = "home";
    }
  });
  this.listen(this.rhmi, "applicationStackChanged", function (stack) {
    if (stack && Object.prototype.hasOwnProperty.call(stack, "ROOT_APP"))
      self.seenRoot = true;
    if (!self.seenRoot) return;
    var h = self.component("HOME"),
      id = h.getId(),
      roots = stack && Array.isArray(stack.ROOT_APP) ? stack.ROOT_APP : [];
    if (
      !roots.some(function (x) {
        return String(x) === String(id);
      })
    ) {
      self.visible = false;
      self.revoke();
      self.clearDeleteNotice();
      self.page = "home";
    }
  });
  var home = this.component("HOME");
  if (home.updateResources) await home.updateResources();
  await this.rhmi.mapEntryState(this.entry, home);
  await this.render();
};
UI.prototype.showRecordingAlert = async function (notice) {
  if(this.closed)return;
  var expiresAt=Date.now()+1800;
  var overlay=this.component('RECORDING_ALERT'),text=this.component('RECORDING_ALERT_TEXT');
  if(!overlay||!text||!text.setValue)throw Error('Recording notification overlay unavailable');
  if(overlay.updateResources)await overlay.updateResources();
  await text.setValue(0,'Description_Text',notice.message,'Text');
  if(this.closed||notice.kind!=='test'&&this.intent().continuous===false)return;
  if(Date.now()>expiresAt)throw Error('Recording notification expired');
  await this.rhmi.openState('RECORDING_ALERT');
};
UI.prototype.openMenu = async function () {
  if (this.closed) return;
  this.clearDeleteNotice();
  this.revoke();
  this.page = "home";
  if(this.onboarding&&!this.noticeHandled){try{if(this.onboarding.pending())this.page="welcome";}catch(e){this.report(e);this.page="welcome";}}
  await this.rhmi.mapEntryState(this.entry, this.component("HOME"));
  try {
    await this.rhmi.openEntryState(this.entry);
  } catch (e) {
    if (!/INVALID_UUID/.test(e.message)) throw e;
  }
  await this.rhmi.openState("HOME");
  this.visible = true;
  await this.render();
};
UI.prototype.press = async function (row) {
  if (this.closed || !this.visible) return;
  var desk = this.desk(),
    intent = this.intent();
  if (desk.setupPending && (this.page === "home" && ["HOME_ALL", "HOME_LEFT"].indexOf(row) >= 0 || this.page === "usb" && row === "HOME_DELETE" || this.page === "delete-confirm" && row === "HOME_ALL")) {
    this.message = desk.state || "Recorder setup pending";
    await this.render();
    return;
  }
  if(this.page==="welcome"){if(row==="HOME_ALL"){try{this.onboarding.acknowledge();}catch(e){this.report(e);}this.noticeHandled=true;this.page="home";await this.render();}return;}
  if (this.page === "home") {
    if (row === "HOME_ALL") {
      if (!desk.drive)
        this.message = "Connect a writable USB drive before recording.";
      else {
        this.message = "";
        this.update({ continuous: intent.continuous !== true });
      }
    }
    else if (row === "HOME_REAR") {
      this.clearDeleteNotice();
      this.page = "usb";
      this.drivePage = 0;
    } else if (row === "HOME_LEFT") {
      if(!desk.drive){this.message="Connect a writable USB drive first.";await this.render();return;}
      this.revoke();
      this.visit = crypto.randomBytes(16).toString("hex");
      this.page = "connect";
      this.beat();
    }
    else if (row === "HOME_RIGHT") {this.page="settings";this.message="";}
  } else if (this.page === "delete-confirm") {
    if(row === "HOME_ALL"){
      if(!desk.drive||desk.drive.mount!==this.deleteVolume){this.message="The selected USB drive changed. Nothing deleted.";this.page="usb";}
      else {this.revoke();var deleteId=crypto.randomBytes(16).toString('hex');this.deleteNoticeId=deleteId;this.deleteNoticeVolumeToken=this.deleteVolumeToken;this.update({continuous:false,deleteAll:{id:deleteId,volume:this.deleteVolume,volumeToken:this.deleteVolumeToken,confirmed:true}});this.message="";this.page="usb";}
    }else if(row === "HOME_FRONT"){this.page="usb";this.message="";}
  } else if (this.page === "usb") {
    if(row === "HOME_DELETE" && desk.drive){this.clearDeleteNotice();this.deleteVolume=desk.drive.mount;this.deleteVolumeToken=desk.volumeToken;this.page="delete-confirm";this.message="";await this.render();return;}
    var i = ["HOME_ALL", "HOME_FRONT", "HOME_REAR", "HOME_LEFT"].indexOf(row),
      drives = desk.drives || [];
    if (i >= 0 && drives[this.drivePage * 4 + i]) {
      var target = drives[this.drivePage * 4 + i].mount,
        current = desk.drive && desk.drive.mount;
      if (
        current &&
        target !== current &&
        (desk.activeId || desk.state === "Recording")
      )
        this.message =
          "Cannot disconnect the drive while a recording is saving.";
      else {
        this.message = "";
        this.update({ volume: target });
      }
    }
    else if (row === "HOME_RIGHT")
      this.drivePage =
        (this.drivePage + 1) % Math.max(1, Math.ceil(drives.length / 4));
  } else if (this.page === "connect" && row === "HOME_ALL") {
    this.revoke();
    this.page = "home";
  }
  await this.render();
};
UI.prototype.back = async function () {
  this.clearDeleteNotice();
  this.revoke();
  this.page = "home";
  await this.render();
};
function bytes(n) {
  if (typeof n !== "number" || !isFinite(n)) return "Unknown";
  if (n < 1024) return n + " B";
  var units = ["KiB", "MiB", "GiB", "TiB"],
    i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < 3);
  return n.toFixed(1) + " " + units[i];
}
UI.prototype.render = function () {
  if (this.closed) return Promise.resolve();
  if (this.rendering) { this.renderAgain = true; return this.rendering; }
  var self = this;
  this.rendering = (async function () {
    try {
      do {
        self.renderAgain = false;
        await self.renderPage();
      } while (self.renderAgain && !self.closed);
    } finally { self.rendering = null; }
  })();
  return this.rendering;
};
UI.prototype.renderPage = async function () {
  if (this.closed) return;
  var desk = this.desk(),
    intent = this.intent(),
    drive = desk.drive,
    labels = { HOME_TITLE: "BimmerVision" },
    transfer = desk.transfer || {};
  var deletionNotice="";
  if(this.page==="usb" && this.deleteNoticeId && desk.volumeToken===this.deleteNoticeVolumeToken) {
    var result=desk.deleteResult;
    if(result && result.id===this.deleteNoticeId) deletionNotice=result.error || (result.deleted+" recordings erased · "+(result.locked||0)+" locked kept"+(result.retainedDependencies?" · "+result.retainedDependencies+" needed for playback":""));
    else deletionNotice="Erasing unlocked recordings…";
  }
  var enabled = intent.continuous === true,
    finishing = !desk.deleting && (desk.finalizing === true || desk.state === "Saving last video" ||
      !enabled && (desk.activeId || desk.writeInProgress === true && desk.finalizing === undefined || desk.state === "Recording")),
    videoWriting = finishing || desk.finalizing === true || desk.activeId || desk.state === "Recording" || desk.state === "Saving last video",
    writingMessage = "Do not disconnect - " + (videoWriting ? "Saving last video" : "Writing to USB"),
    recordingState = finishing ? "Saving last video" :
      ((desk.state === "Recording" || desk.activeId) ? "Recording" : (desk.state || "Recorder unavailable"));
  if(this.visible && enabled && !finishing && desk.state==="Recording" && desk.activeId && !desk.error && !desk.deleting) labels.HOME_TITLE="BimmerVision   "+(Math.floor(this.nowMs()/500)%2?"○":"●")+" REC";
  if(this.page === "connect" && !drive){this.revoke();this.page="home";this.message="USB disconnected. Connect Phone unavailable.";}
  if(this.page==="welcome"){labels.HOME_STATUS=require("./first-run-notice").message;labels.HOME_ALL="Understood";labels.HOME_AUTO="Back";}
  else if (this.page === "home") {
    labels.HOME_STATUS =
      recordingState + (drive && typeof desk.recordingCount === "number" ? " · " + desk.recordingCount + " recordings" : "") +
      "\n" +
      (drive
        ? (drive.name || drive.mount || "USB") +
          " · " +
          bytes(drive.used) +
          " used · " +
          bytes(drive.free) +
          " free / " +
          bytes(drive.total) +
          ""
        : desk.drives && desk.drives.length
          ? "Select a USB drive to record"
          : "No writable USB drive detected\nConnect a USB drive") +
      (drive ? "\n" + (desk.deleting ? "Do not disconnect - Deleting recordings" : (desk.writeInProgress===true || desk.writeInProgress===undefined && videoWriting) ? writingMessage : desk.safeToRemove===false || desk.error ? "USB error - Safe removal not confirmed" : "Safe to Remove") : "") +
      "";
    labels.HOME_ALL = drive
      ? enabled
        ? "Pause recording"
        : "Enable recording"
      : "Enable recording";
    labels.HOME_REAR = "USB storage";
    labels.HOME_LEFT = "Connect Phone";
    labels.HOME_RIGHT = "Settings / About";
  } else if (this.page === "delete-confirm") {
    labels.HOME_STATUS="Erase all unlocked recordings?\n"+(drive ? drive.name||drive.mount : "USB disconnected")+" · "+(desk.lockedRecordingCount==null?"Locked count unavailable":desk.lockedRecordingCount+" locked")+"\nLocked recordings are kept. This cannot be undone.";
    labels.HOME_ALL="Erase unlocked recordings";labels.HOME_FRONT="Cancel";labels.HOME_AUTO="Back";
  } else if (this.page === "usb") {
    labels.HOME_STATUS =
      "USB storage\n" +
      (drive
        ? (drive.name || drive.mount) +
          " · " +
          bytes(drive.free) +
          " free / " +
          bytes(drive.total)
        : "Select a drive for recordings");
    var drives = desk.drives || [],
      rows = ["HOME_ALL", "HOME_FRONT", "HOME_REAR", "HOME_LEFT"];
    for (var n = 0; n < 4; n++) {
      var d = drives[this.drivePage * 4 + n];
      if (d)
        labels[rows[n]] =
          (d.mount === intent.volume ? "Selected · " : "") +
          (d.name || d.mount) +
          " · " +
          bytes(d.free) +
          " free";
    }
    if (!drives.length)
      labels.HOME_STATUS +=
        "\nNo writable USB drive detected\nConnect a USB drive";
    if(drive) labels.HOME_DELETE="Erase all unlocked recordings…";
    if(drive) labels.HOME_STATUS+="\n"+(desk.recordingCount==null?"":desk.recordingCount+" recordings · ")+(desk.lockedRecordingCount==null?"Locked count unavailable · ":desk.lockedRecordingCount+" locked · ")+(desk.deleting?"Do not disconnect - Deleting recordings":desk.writeInProgress?writingMessage:desk.safeToRemove===false||desk.error?"USB error - Safe removal not confirmed":"Safe to Remove");
    if (drives.length > 4) labels.HOME_RIGHT = "Next drives";
    labels.HOME_AUTO = "Back";
  } else if(this.page==="settings") {
    labels.HOME_STATUS="BimmerVision "+require('../package.json').version+" · GitHub: Hexphase/BimmerVision\nComputer: Visit BimmerVision.App and connect your USB drive to view footage.\nPhone: Connect Phone on the previous page connects directly to your car.";
    labels.HOME_AUTO="Back";
  } else {
    labels.HOME_STATUS = "Connect Phone" +
      (transfer.paired ? " · Connected" : transfer.code ? " · Code " + transfer.code : "") + "\n" +
      (transfer.paired ? "One device connected" : transfer.code ? (transfer.url||"").split("/?")[0] : transfer.error || "Starting connection…") +
      "\n" + "BMW Wi-Fi / CarPlay · Keep this screen open";
    labels.HOME_AUTO = "Back";
  }
  var notice=this.message||desk.storageWarning||desk.error||deletionNotice;
  if(notice){if(this.page==="home"||this.page==="usb")labels.HOME_STATUS=notice+(this.page==="home"&&drive&&typeof desk.recordingCount==="number"?" · "+desk.recordingCount+" recordings":"")+labels.HOME_STATUS.slice(labels.HOME_STATUS.indexOf("\n"));else labels.HOME_STATUS+="\n"+notice;}
  var all = ["HOME_STATUS", "HOME_TITLE", "HOME_QR"].concat(ROWS);
  for (var j = 0; j < all.length; j++) {
    var name = all[j],
      c = this.component(name),
      value = labels[name];
    if (c && c.setVisible) await c.setVisible(value !== undefined);
    if (value !== undefined) await this.text(name, value);
    if (name === "HOME_ALL" && c && c.setEnabled)
      await c.setEnabled(this.page !== "home" || !!drive);
    if(name === "HOME_FRONT" && c && c.setEnabled) await c.setEnabled(true);
    if(name === "HOME_LEFT" && c && c.setEnabled) await c.setEnabled(this.page !== "home" || !!drive);
    if(name === "HOME_DELETE" && c && c.setEnabled) await c.setEnabled(!!drive && !desk.deleting);
    if (name === "HOME_QR" && c && c.setVisible)
      await c.setVisible(this.page === "connect" && transfer.on === true && !!transfer.url && !this.preferExternalQr);
  }
};
UI.prototype.publishQr = async function (url) {
  var image = this.component("HOME_QR");
  if (!image || !image.setRowGraphic || !image.getResourceBundle) return false;
  var bundle = image.getResourceBundle();
  if (!bundle || !bundle.resourceFolder || !bundle.createResourceHandles) return false;
  var file = path.join(bundle.resourceFolder, "pairing-qr.png");
  fs.writeFileSync(file, qr.png(url));
  if (
    bundle.resourceTable &&
    Number.isInteger(bundle.resourceTable["pairing-qr.png"]) &&
    bundle.destroyResourceHandles
  ) {
    await bundle.destroyResourceHandles(["pairing-qr.png"]);
    delete bundle.resourceTable["pairing-qr.png"];
  }
  await bundle.createResourceHandles(["pairing-qr.png"]);
  await image.setRowGraphic(0, "pairing-qr.png");
  if (image.setVisible) await image.setVisible(true);
  return true;
};
UI.prototype.paint = async function () {
  if (this.closed || !this.visible) return;
  if (this.page === "connect" && this.visit) {
    var transfer = this.desk().transfer || {};
    if (transfer.url && transfer.url !== this.qrUrl && this.display) {
      var shown = false;
      try {
        shown = !this.preferExternalQr && !!(await this.publishQr(transfer.url));
      } catch (e) {
        this.message = "QR unavailable — use the code above";
      }
      try {
        this.externalQr = false;
        if (!shown && this.display) {
          await this.display.draw(qr.frame(transfer.url));
          this.externalQr = true;
          shown = true;
        } else if(shown && this.display) this.display.hide();
      } catch (e) {
        if (!shown) this.message = "QR unavailable — use the code above";
      }
      if (shown) this.qrUrl = transfer.url;
    } else if (transfer.url && this.externalQr && this.display && this.display.hold)
      await this.display.hold();
    else if (!transfer.url && this.qrUrl) {
      this.qrUrl = "";
  this.externalQr = false;
      if (this.display) this.display.hide();
    }
  }
  await this.render();
};
UI.prototype.close = function () {
  this.clearDeleteNotice();
  this.revoke();
  this.closed = true;
  this.visible = false;
  this.listeners.forEach(function (x) {
    x[0].removeListener(x[1], x[2]);
  });
  this.listeners = [];
};
module.exports = { UI: UI };
