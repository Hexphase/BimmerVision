"use strict";
var fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
function uid() {
  return process.getuid();
}
function directory(dir) {
  var s = fs.lstatSync(dir);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    s.uid !== uid() ||
    (s.mode & 511) !== 448
  )
    throw new Error("Unsafe recorder RAM directory");
}
function check(file) {
  try {
    var s = fs.lstatSync(file);
    if (
      !s.isFile() ||
      s.isSymbolicLink() ||
      s.uid !== uid() ||
      (s.mode & 511) !== 384 ||
      s.size > 65536
    )
      throw new Error("Unsafe recorder RAM file");
    return s;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
function read(file) {
  if (!check(file)) return {};
  var value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid recorder data");
  return value;
}
function Recording(dir) {
  directory(dir);
  this.directory = dir;
  this.controlFile = path.join(dir, "recorder-control.json");
  this.statusFile = path.join(dir, "recorder-status.json");
}
Recording.prototype.read = function () {
  try {
    directory(this.directory);
    var s = read(this.statusFile);
    if (!Array.isArray(s.drives)) s.drives = [];
    return s;
  } catch (e) {
    return { state: "Recorder unavailable", error: e.message, drives: [] };
  }
};
Recording.prototype.intent = function () {
  try {
    directory(this.directory);
    return read(this.controlFile);
  } catch (e) {
    return {};
  }
};
Recording.prototype.update = function (patch) {
  directory(this.directory);
  var current = read(this.controlFile);
  Object.keys(patch).forEach(function (k) {
    current[k] = patch[k];
  });
  var body = JSON.stringify(current);
  if (Buffer.byteLength(body) > 8192)
    throw new Error("Recorder control too large");
  var tmp = this.controlFile + ".tmp-" + crypto.randomBytes(8).toString("hex"),
    fd = fs.openSync(tmp, "wx", 384);
  try {
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    directory(this.directory);
    check(this.controlFile);
    fs.renameSync(tmp, this.controlFile);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return current;
};
module.exports = { Recording: Recording };
