"use strict";
var fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  io = require("./io");
function initial() {
  return {
    version: 1,
    account: null,
    settings: {
      autoUpload: false,
      pauseRecording: false,
      doNotBackupWhileDriving: false,
      onlyLockedDrives: false,
      serviceId: null,
    },
    queue: [],
    completed: [],
  };
}
function State(dir) {
  this.dir = dir;
  this.serial = Promise.resolve();
}
State.prototype.directory = async function () {
  await io.ensureDir(this.dir, 448);
  var st = await io.lstat(this.dir);
  if (st.uid !== process.getuid() || (st.mode & 511) !== 448)
    throw Error("Unsafe backup state directory");
};
State.prototype.read = async function (name) {
  var file = path.join(this.dir, name),
    st = await io.safePath(file, "file");
  if (
    st.uid !== process.getuid() ||
    (st.mode & 511) !== 384 ||
    st.size > 32 * 1024 * 1024
  )
    throw Error("Unsafe backup state file");
  var fd = await io.open(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    var value = JSON.parse((await io.readAt(fd, st.size, 0)).toString("utf8"));
    if (!value || value.version !== 1 || !Array.isArray(value.queue))
      throw Error("Invalid backup state schema");
    return value;
  } finally {
    await io.close(fd);
  }
};
State.prototype.load = async function () {
  await this.directory();
  try {
    return await this.read("state.json");
  } catch (e) {
    if (
      e.code !== "ENOENT" &&
      !(e instanceof SyntaxError) &&
      e.message !== "Invalid backup state schema"
    )
      throw e;
    try {
      return await this.read("state.bak");
    } catch (old) {
      if (old.code === "ENOENT" && e.code === "ENOENT") return initial();
      throw Error("Backup state needs recovery; originals have not changed");
    }
  }
};
State.prototype.atomic = async function (name, value) {
  var tmp = path.join(
      this.dir,
      ".write-" + crypto.randomBytes(8).toString("hex"),
    ),
    fd;
  try {
    fd = await io.open(
      tmp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      384,
    );
    await io.writeAll(fd, Buffer.from(JSON.stringify(value) + "\n"));
    await io.fsync(fd);
    await io.close(fd);
    fd = null;
    await io.rename(tmp, path.join(this.dir, name));
    await io.syncDir(this.dir);
  } finally {
    if (fd != null) await io.close(fd);
    try {
      await io.unlink(tmp);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
};
State.prototype.save = function (value) {
  var self = this,
    copy = JSON.parse(JSON.stringify(value));
  if (copy.version !== 1 || !Array.isArray(copy.queue))
    return Promise.reject(Error("Invalid backup state schema"));
  var next = this.serial.then(async function () {
    await self.directory();
    var old = null;
    try {
      old = await self.read("state.json");
    } catch (e) {
      if (
        e.code !== "ENOENT" &&
        !(e instanceof SyntaxError) &&
        e.message !== "Invalid backup state schema"
      )
        throw e;
      try {
        old = await self.read("state.bak");
      } catch (recovery) {
        if (e.code !== "ENOENT" || recovery.code !== "ENOENT") throw recovery;
      }
    }
    if (old) {
      if (
        !copy.account ||
        !old.account ||
        copy.account.generation !== old.account.generation
      )
        old.account = null;
      await self.atomic("state.bak", old);
    }
    await self.atomic("state.json", copy);
  });
  this.serial = next.catch(function () {});
  return next;
};
module.exports = { State: State, initial: initial };
