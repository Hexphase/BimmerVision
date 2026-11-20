"use strict";
var fs = require("fs"),
  cp = require("child_process"),
  util = require("util"),
  net = require("net"),
  os = require("os");
async function probe() {
  var iface = "wlan0";
  await util.promisify(fs.stat)("/sys/class/net/" + iface + "/wireless");
  var result;
  try {
    result = await util.promisify(cp.execFile)(
      "/usr/sbin/wpa_cli",
      ["-i", iface, "status"],
      { timeout: 2000, maxBuffer: 16384 },
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return probeDbus();
  }
  var fields = {};
  result.stdout.split("\n").forEach(function (line) {
    var n = line.indexOf("=");
    if (n > 0) fields[line.slice(0, n)] = line.slice(n + 1);
  });
  return {
    wireless: true,
    interface: iface,
    connected: fields.wpa_state === "COMPLETED" && fields.mode === "station",
    ssid: fields.ssid,
    address: fields.ip_address,
  };
}
// This BMW firmware exposes wpa_supplicant on D-Bus but ships no wpa_cli.
async function probeDbus(options) {
  var o = options || {},
    run = o.run || util.promisify(cp.execFile),
    iface = "wlan0",
    service = "fi.w1.wpa_supplicant1";
  async function call(args) {
    return (
      await run("/usr/bin/busctl", ["--system"].concat(args), {
        timeout: 2000,
        maxBuffer: 16384,
      })
    ).stdout.trim();
  }
  function value(text, type) {
    if (text.slice(0, 2) !== type + " ")
      throw Error("Invalid Wi-Fi D-Bus response");
    var result = JSON.parse(text.slice(2));
    if (typeof result !== "string") throw Error("Invalid Wi-Fi D-Bus value");
    return result;
  }
  var ipath = value(
    await call([
      "call",
      service,
      "/fi/w1/wpa_supplicant1",
      service,
      "GetInterface",
      "s",
      iface,
    ]),
    "o",
  );
  if (!/^\/fi\/w1\/wpa_supplicant1\/Interfaces\/[0-9]+$/.test(ipath))
    throw Error("Invalid Wi-Fi interface");
  var state = value(
    await call([
      "get-property",
      service,
      ipath,
      service + ".Interface",
      "State",
    ]),
    "s",
  );
  if (state !== "completed")
    return { wireless: true, interface: iface, connected: false };
  var bss = value(
    await call([
      "get-property",
      service,
      ipath,
      service + ".Interface",
      "CurrentBSS",
    ]),
    "o",
  );
  if (
    bss.indexOf(ipath + "/BSSs/") !== 0 ||
    !/^\d+$/.test(bss.slice((ipath + "/BSSs/").length))
  )
    throw Error("Invalid Wi-Fi BSS");
  var mode = value(
    await call(["get-property", service, bss, service + ".BSS", "Mode"]),
    "s",
  );
  if (mode !== "infrastructure")
    return { wireless: true, interface: iface, connected: false };
  var encoded = (
      await call(["get-property", service, bss, service + ".BSS", "SSID"])
    ).split(/\s+/),
    length = Number(encoded[1]),
    bytes = encoded.slice(2);
  if (
    encoded[0] !== "ay" ||
    !Number.isInteger(length) ||
    length < 1 ||
    length > 32 ||
    bytes.length !== length ||
    bytes.some(function (v) {
      return !/^\d+$/.test(v) || Number(v) > 255;
    })
  )
    throw Error("Invalid Wi-Fi SSID");
  var buffer = Buffer.from(bytes.map(Number)),
    ssid = buffer.toString("utf8");
  if (!Buffer.from(ssid, "utf8").equals(buffer) || ssid.indexOf("\0") >= 0)
    throw Error("Invalid Wi-Fi SSID encoding");
  var addresses = (o.interfaces || os.networkInterfaces)()[iface] || [],
    address = addresses.filter(function (a) {
      return (
        !a.internal &&
        (a.family === "IPv4" || a.family === 4) &&
        net.isIP(a.address) === 4
      );
    })[0];
  return {
    wireless: true,
    interface: iface,
    connected: true,
    ssid: ssid,
    address: address && address.address,
  };
}
function NetworkGate(options) {
  var o = options || {};
  this.probe = o.probe || probe;
  this.serviceId = o.serviceId || null;
  this.listeners = new Set();
  this.last = null;
  this.closed = false;
  this.timer = null;
}
NetworkGate.prototype.snapshot = async function () {
  var raw;
  try {
    raw = await this.probe();
  } catch (e) {
    raw = {};
  }
  var good =
    !this.closed &&
    raw.wireless === true &&
    raw.connected === true &&
    /^wlan[0-9]+$/.test(raw.interface || "") &&
    net.isIP(raw.address || "") === 4 &&
    !/^(0\.|127\.|169\.254\.)/.test(raw.address) &&
    typeof raw.ssid === "string" &&
    raw.ssid.length > 0 &&
    raw.ssid.length <= 32 &&
    (!this.serviceId || raw.ssid === this.serviceId);
  var next = {
    eligible: good,
    interface: raw.interface || null,
    address: raw.address || null,
    serviceId: raw.ssid || null,
    reason: good ? "" : "Connect the car to permitted internet Wi-Fi",
  };
  if (this.last && JSON.stringify(next) !== JSON.stringify(this.last))
    this.listeners.forEach(function (fn) {
      fn(next);
    });
  this.last = next;
  return next;
};
NetworkGate.prototype.subscribe = function (fn) {
  var self = this;
  this.listeners.add(fn);
  if (!this.timer) {
    this.timer = setInterval(function () {
      self.snapshot().catch(function () {});
    }, 500);
    if (this.timer.unref) this.timer.unref();
  }
  return function () {
    self.listeners.delete(fn);
    if (!self.listeners.size) {
      clearInterval(self.timer);
      self.timer = null;
    }
  };
};
NetworkGate.prototype.close = function () {
  this.closed = true;
  clearInterval(this.timer);
  this.timer = null;
  this.listeners.forEach(function (fn) {
    fn({ eligible: false });
  });
  this.listeners.clear();
};
module.exports = { NetworkGate: NetworkGate, probeDbus: probeDbus };
