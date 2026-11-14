"use strict";
// Existing mgu-render/1 protocol, restricted to generated pairing QR frames.
var net = require("net"),
  fs = require("fs"),
  path = require("path");

function msg(type, payload) {
  payload = payload || Buffer.alloc(0);
  var b = Buffer.alloc(8 + payload.length + ((4 - (payload.length % 4)) % 4));
  b.writeUInt32LE(type, 0);
  b.writeUInt32LE(b.length - 8, 4);
  payload.copy(b, 8);
  return b;
}
function words(a) {
  var b = Buffer.alloc(a.length * 4);
  a.forEach(function (v, i) {
    b.writeUInt32LE(v >>> 0, i * 4);
  });
  return b;
}
function pictureFrame(screen, top) {
  var h = screen.h - top;
  var w = Math.floor((h * 4) / 3);
  if (w > screen.w) {
    w = screen.w - (screen.w % 2);
    h = Math.floor((w * 3) / 4);
  }
  w -= w % 2;
  h -= h % 2;
  return {
    x: Math.floor((screen.w - w) / 2),
    y: top + Math.floor((screen.h - top - h) / 2),
    w: w,
    h: h,
  };
}
function QRDisplay(o) {
  this.socket = o.socket || "/run/mgu-render/render.sock";
  this.file = o.file;
  this.verified = o.verified === true;
  this.sock = null;
  this.box = { x: 108, y: 82, w: 1790, h: 638 };
  this.embed = null;
  this.mode = 1;
  this.loading = null;
  this.epoch = 0;
  this.target = "headunit";
  this.offerEmbed = false;
  this.frameOverride = o.frame || null;
  this.report = o.report || function () {};
  this.lastState = "";
}
QRDisplay.prototype.send = function (t, p) {
  if (this.sock && !this.sock.destroyed) this.sock.write(msg(t, p));
};
QRDisplay.prototype.placement = function () {
  if (
    this.frameOverride &&
    this.frameOverride.w >= 16 &&
    this.frameOverride.h >= 16
  )
    return { mode: this.mode, rect: this.frameOverride };
  // The native RHMI menu does not sample the renderer embedded surface.
  var host = this.box;
  var mode = 1;
  var side = Math.min(host.w, host.h) - 36;
  side = Math.min(side, Math.floor(host.w * 0.30), 320);
  if (side < 160) side = Math.min(host.w, host.h);
  side -= side % 2;
  return {
    mode: mode,
    rect: {
      x: host.x + host.w - side - 28,
      y: host.y + host.h - side - 28,
      w: side,
      h: side,
    },
  };
};
QRDisplay.prototype.layout = function () {
  var place = this.placement(),
    x = place.rect.x,
    y = place.rect.y,
    w = place.rect.w,
    h = place.rect.h;
  this.mode = place.mode;
  var bytes = Buffer.alloc(28);
  bytes.writeInt32LE(x, 0);
  bytes.writeInt32LE(y, 4);
  bytes.writeInt32LE(w, 8);
  bytes.writeInt32LE(h, 12);
  bytes.writeFloatLE(1, 16);
  this.send(0x4d520001, words([this.mode]));
  this.send(2, bytes);
  this.send(
    13,
    Buffer.concat([words([1]), Buffer.from(this.presented || this.file)])
  );
  this.send(3, words([1]));
  var floats = new Float32Array([0, 0, w, h, 0]),
    u = new Uint32Array(floats.buffer);
  this.send(7, words([19, u[0], u[1], u[2], u[3], u[4], 1]));
};
QRDisplay.prototype.connect = function () {
  var self = this;
  if (this.loading) return this.loading;
  if (this.sock && !this.sock.destroyed) return Promise.resolve();
  if (!this.verified)
    return Promise.reject(new Error("QR renderer is not enabled"));
  this.loading = new Promise(function (resolve, reject) {
    var sock = net.createConnection(self.socket),
      inbox = Buffer.alloc(0),
      done = false;
    self.sock = sock;
    var timer = setTimeout(function () {
      sock.destroy();
      if (!done) {
        done = true;
        reject(new Error("QR renderer unavailable"));
      }
    }, 2000);
    sock.on("connect", function () {
      sock.write(msg(1, Buffer.from("bimmervision\0proto=mgu-render/1")));
    });
    sock.on("error", function (e) {
      clearTimeout(timer);
      if (!done) {
        done = true;
        reject(e);
      }
    });
    sock.on("close", function () {
      clearTimeout(timer);
      if (self.sock === sock) self.sock = null;
      if (done) self.report("display-socket-closed");
      if (!done) {
        done = true;
        reject(new Error("QR renderer closed"));
      }
    });
    sock.on("data", function (data) {
      inbox = Buffer.concat([inbox, data]);
      if (inbox.length > 65536) {
        sock.destroy();
        return;
      }
      while (inbox.length >= 8) {
        var type = inbox.readUInt32LE(0),
          n = inbox.readUInt32LE(4);
        if (n > 65528) {
          sock.destroy();
          return;
        }
        if (inbox.length < 8 + n) break;
        var p = inbox.slice(8, 8 + n);
        inbox = inbox.slice(8 + n);
        if (type === 0x4d520101 && p.length >= 44) {
          var flags = p.readUInt32LE(4);
          var embed = {
            x: p.readInt32LE(12),
            y: p.readInt32LE(16),
            w: p.readInt32LE(20),
            h: p.readInt32LE(24),
          };
          var b = {
            x: p.readInt32LE(28),
            y: p.readInt32LE(32),
            w: p.readInt32LE(36),
            h: p.readInt32LE(40),
          };
          if (b.w >= 16 && b.h >= 100) self.box = b;
          if (self.readyLog !== flags) {
            self.readyLog = flags;
            self.report(
              "renderer-ready flags=" +
                flags +
                " embed=" +
                embed.x +
                "," +
                embed.y +
                " " +
                embed.w +
                "x" +
                embed.h
            );
          }
          if (flags & 2 && embed.w >= 16 && embed.h >= 16) {
            self.embed = embed;
            self.offerEmbed = true;
          }
        }
        if (type === 103)
          self.report("renderer-error: " + p.toString("utf8").slice(0, 200));
        if (type === 0x4d520102 && p.length >= 12) {
          var state =
            "renderer-state mode=" +
            p.readUInt32LE(0) +
            " onScreen=" +
            p.readUInt32LE(4) +
            " front=" +
            p.readUInt32LE(8);
          if (self.lastState !== state) {
            self.lastState = state;
            self.report(state);
          }
        }
        if (type === 101 && !done) {
          done = true;
          clearTimeout(timer);
          resolve();
        }
      }
    });
  }).then(
    function () {
      self.loading = null;
    },
    function (e) {
      self.loading = null;
      throw e;
    }
  );
  return this.loading;
};
QRDisplay.prototype.draw = async function (buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < 64 ||
    buffer.readUInt32LE(0) !== 0x4656474d
  )
    throw new Error("Invalid QR frame");
  if (!this.verified) throw new Error("QR renderer is not enabled");
  var epoch = this.epoch;
  var fd;
  if (fs.existsSync(this.file)) {
    var s = fs.lstatSync(this.file);
    if (
      s.isSymbolicLink() ||
      !s.isFile() ||
      s.uid !== (process.getuid ? process.getuid() : s.uid)
    )
      throw new Error("Unsafe output frame");
    fd = fs.openSync(this.file, "r+");
  } else fd = fs.openSync(this.file, "wx", 384);
  try {
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, buffer);
  } finally {
    fs.closeSync(fd);
  }
  await this.connect();
  if (epoch !== this.epoch) return false;
  this.layout();
  this.cover(true);
  return true;
};
QRDisplay.prototype.hold = async function () {
  if (!this.verified) return false;
  this.cover(true);
  if (!this.sock || this.sock.destroyed) {
    try {
      await this.connect();
    } catch (e) {
      return false;
    }
  }
  this.layout();
  return true;
};
QRDisplay.prototype.cover = function (on) {
  try {
    var dir =
      "/tmp/bimmervision-" + (process.getuid ? process.getuid() : "owner");
    fs.writeFileSync(path.join(dir, "cover"), on ? "1\n" : "0\n");
  } catch (ignored) {}
};
QRDisplay.prototype.hideHead = function () {
  this.epoch++;
  var from = "";
  try {
    from = String(new Error().stack).split("\n")[2] || "";
    from = from.replace(/^\s*at\s+/, "").split(" ")[0];
  } catch (ignored) {}
  this.report("display-hide " + from);
  this.cover(false);
  this.send(3, words([0]));
  if (this.sock) this.sock.destroy();
  this.sock = null;
};
QRDisplay.prototype.hide = function () {
  this.hideHead();
};
module.exports = { QRDisplay: QRDisplay };
