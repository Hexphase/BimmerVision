"use strict";
var fs = require("fs"),
  os = require("os"),
  path = require("path"),
  cp = require("child_process"),
  net = require("net"),
  URL = require("url").URL;
function quoted(value) {
  if (/[\r\n\0]/.test(value)) throw Error("Invalid request value");
  return '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function destination(value) {
  var u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    ["oauth2.googleapis.com", "www.googleapis.com"].indexOf(u.hostname) < 0
  )
    throw Error("Backup destination is not allowed");
  return u.href;
}
function Transport(options) {
  var o = options || {};
  this.network = o.network;
  this.uploadPermitted = o.uploadPermitted;
  this.requestPermitted = o.requestPermitted;
  this.spawn = o.spawn || cp.spawn;
  this.launcher = o.launcher || path.join(__dirname, "backup-wifi-curl");
  this.caBundleFile = o.caBundleFile || path.join(__dirname, "backup-ca-bundle.pem");
  this.identity = o.identity || function () {
    var file = "/var/opt/bimmervision-recorder/data/backup-network-uid";
    var st = require("./setup").safe(file), text = fs.readFileSync(file, "utf8");
    var uid = Number(text.trim());
    if (!st.isFile() || st.uid !== 0 || (st.mode & 63) || st.size > 16 ||
        !/^\d+\n$/.test(text) || !Number.isInteger(uid) || uid < 1 || uid > 60000)
      throw Error("Unsafe backup network identity");
    return { uid: uid, gid: uid };
  };
  this.active = new Set();
  this.closed = false;
  this.dns = new Map();
}
Transport.prototype.request = async function (options) {
  var o = options || {},
    url = destination(o.url),
    host = new URL(url).hostname,
    wifi = await this.network.snapshot();
  if (this.closed || !wifi.eligible) throw Error("Waiting for Wi-Fi");
  if (this.requestPermitted && this.requestPermitted() !== true) throw Error("Phone connected; car backup paused");
  if (o.uploadBody && (!this.uploadPermitted || this.uploadPermitted() !== true))
    throw Error("Waiting until the car is stationary");
  var key = [host, wifi.interface, wifi.address, wifi.serviceId].join(":"),
    entry = this.dns.get(key);
  if (!entry || Date.now() >= entry.expiresAt) {
    var response = await this.exchange(
        {
          url:
            "https://1.1.1.1/dns-query?name=" +
            encodeURIComponent(host) +
            "&type=A",
          headers: { Accept: "application/dns-json" },
        },
        wifi,
        null,
      ),
      value;
    try {
      value = JSON.parse(response.body.toString("utf8"));
    } catch (e) {
      throw Error("Wi-Fi DNS unavailable");
    }
    var answer =
      value.Status === 0 &&
      Array.isArray(value.Answer) &&
      value.Answer.filter(function (a) {
        return (
          a.type === 1 &&
          net.isIP(a.data) === 4 &&
          !/^(0\.|10\.|127\.|169\.254\.|192\.168\.)/.test(a.data)
        );
      })[0];
    if (response.status !== 200 || !answer)
      throw Error("Wi-Fi DNS unavailable");
    entry = {
      address: answer.data,
      expiresAt:
        Date.now() + Math.max(1000, Math.min(60000, (answer.TTL || 30) * 1000)),
    };
    this.dns.set(key, entry);
  }
  return this.exchange(o, wifi, host + ":443:" + entry.address);
};
Transport.prototype.exchange = async function (
  options,
  expectedWifi,
  resolved,
) {
  var self = this,
    o = options || {},
    url = o.url,
    wifi = await this.network.snapshot();
  if (this.requestPermitted && this.requestPermitted() !== true) throw Error("Phone connected; car backup paused");
  if (o.uploadBody && (!this.uploadPermitted || this.uploadPermitted() !== true))
    throw Error("Waiting until the car is stationary");
  if (
    expectedWifi &&
    ["interface", "address", "serviceId"].some(function (k) {
      return expectedWifi[k] !== wifi[k];
    })
  )
    throw Error("Wi-Fi connection changed");
  if (this.closed || !wifi.eligible) throw Error("Waiting for Wi-Fi");
  var identity;
  try { identity = this.identity(); }
  catch (e) { throw Error("Wi-Fi backup network identity unavailable"); }
  if (!identity || !Number.isInteger(identity.uid) || identity.uid < 1 ||
      !Number.isInteger(identity.gid) || identity.gid < 1)
    throw Error("Wi-Fi backup network identity unavailable");
  var method = o.method || "GET";
  if (["GET", "POST", "PUT", "PATCH"].indexOf(method) < 0)
    throw Error("Invalid backup method");
  var body = o.body == null ? null : Buffer.from(o.body);
  if (body && body.length > 8 * 1024 * 1024)
    throw Error("Backup request too large");
  var lines = [
    "url = " + quoted(url),
    "request = " + quoted(method),
    "interface = " + quoted("if!" + wifi.interface),
    "ipv4",
    "cacert = " + quoted(this.caBundleFile),
    'noproxy = "*"',
    'proto = "=https"',
    'proto-redir = "=https"',
    "connect-timeout = 8",
    "max-time = 45",
    "silent",
    "include",
    "show-error",
  ];
  if (resolved) lines.push("resolve = " + quoted(resolved));
  Object.keys(o.headers || {}).forEach(function (k) {
    if (!/^[A-Za-z0-9-]+$/.test(k)) throw Error("Invalid header");
    lines.push("header = " + quoted(k + ": " + o.headers[k]));
  });
  if (body) lines.push('data-binary = "@/dev/fd/3"');
  return new Promise(function (resolve, reject) {
    var child,
      bodyFd = null,
      bodyDir = null,
      finished = false,
      buffers = [],
      size = 0,
      unsubscribe = function () {},
      timer;
    function done(error, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unsubscribe();
      if (o.signal && o.signal.removeListener)
        o.signal.removeListener("abort", abort);
      self.active.delete(abort);
      if (child) {
        child.kill("SIGTERM");
        var force = setTimeout(function () {
          if (child.exitCode == null && child.signalCode == null)
            child.kill("SIGKILL");
        }, 500);
        if (force.unref) force.unref();
      }
      error ? reject(error) : resolve(value);
    }
    function abort() {
      done(Error("Backup connection interrupted"));
    }
    self.active.add(abort);
    if (o.signal && o.signal.aborted) return abort();
    try {
      if (body) {
        bodyDir = fs.mkdtempSync(path.join(os.tmpdir(), "bv-backup-http-"));
        var bodyPath = path.join(bodyDir, "chunk");
        fs.writeFileSync(bodyPath, body, { flag: "wx", mode: 384 });
        bodyFd = fs.openSync(bodyPath, "r");
        fs.fchownSync(bodyFd, identity.uid, identity.gid);
        fs.unlinkSync(bodyPath);
        fs.rmdirSync(bodyDir);
        bodyDir = null;
      }
      child = self.spawn(self.launcher, [wifi.interface], {
        stdio: ["pipe", "pipe", "pipe", bodyFd == null ? "ignore" : bodyFd],
        env: { PATH: "/usr/bin:/bin", LANG: "C" },
      });
    } catch (e) {
      return done(Error("Wi-Fi backup transport unavailable"));
    } finally {
      if (bodyFd != null) fs.closeSync(bodyFd);
    }
    unsubscribe = self.network.subscribe(function (next) {
      if (
        !next.eligible ||
        next.interface !== wifi.interface ||
        next.address !== wifi.address ||
        next.serviceId !== wifi.serviceId
      )
        abort();
    });
    if (o.signal && o.signal.on) o.signal.on("abort", abort);
    timer = setTimeout(abort, 50000);
    child.on("error", function () {
      done(Error("Wi-Fi backup transport unavailable"));
    });
    child.stdout.on("data", function (b) {
      size += b.length;
      if (size > 2 * 1024 * 1024)
        return done(Error("Backup response too large"));
      buffers.push(b);
    });
    child.stderr.on("data", function () {}); // curl errors can echo token-bearing session URLs; never publish them.
    child.on("close", function (code) {
      if (finished) return;
      if (code !== 0)
        return done(
          Error("Wi-Fi/TLS backup request failed (" + String(code) + ")"),
        );
      var raw = Buffer.concat(buffers),
        at = 0,
        head,
        match,
        end;
      do {
        end = raw.indexOf("\r\n\r\n", at);
        if (end < 0) return done(Error("Invalid backup response"));
        head = raw.slice(at, end).toString("utf8");
        match = /^HTTP\/\S+ (\d{3})/.exec(head);
        if (!match) return done(Error("Invalid backup response"));
        at = end + 4;
      } while (Number(match[1]) < 200);
      var headers = {};
      head
        .split("\r\n")
        .slice(1)
        .forEach(function (line) {
          var n = line.indexOf(":");
          if (n > 0)
            headers[line.slice(0, n).toLowerCase()] = line.slice(n + 1).trim();
        });
      done(null, {
        status: Number(match[1]),
        headers: headers,
        body: raw.slice(at),
      });
    });
    child.stdin.on("error", function () {});
    child.stdin.end(lines.join("\n") + "\n");
  });
};
Transport.prototype.cancel = function () {
  this.active.forEach(function (abort) {
    abort();
  });
};
Transport.prototype.close = function () {
  this.closed = true;
  this.cancel();
};
module.exports = { Transport: Transport, destination: destination };
