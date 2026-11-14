"use strict";
var fs = require("fs");
var path = require("path");
function checksum(buf) {
  var sum = 0;
  for (var i = 0; i < 512; i++) sum += buf[i];
  return sum;
}
function writeOctal(buf, value, offset, len) {
  var s = String(value);
  while (s.length < len - 1) s = "0" + s;
  buf.write(s + "\0", offset, len, "ascii");
}
function header(name, size) {
  var b = Buffer.alloc(512, 0);
  b.write(name.slice(0, 100), 0, 100, "ascii");
  writeOctal(b, 420, 100, 8);
  writeOctal(b, 0, 108, 8);
  writeOctal(b, 0, 116, 8);
  writeOctal(b, size, 124, 12);
  writeOctal(b, 0, 136, 12);
  b.write("ustar\0", 257, 6);
  b.write("00", 263, 2);
  writeOctal(b, checksum(b), 148, 8);
  return b;
}
function entry(file, name) {
  return new Promise(function (resolve, reject) {
    fs.stat(file, function (err, st) {
      if (err) return reject(err);
      var out = { name: name, size: st.size, file: file, pad: (512 - (st.size % 512)) % 512 };
      resolve(out);
    });
  });
}
function writeFile(res, file, size, pad) {
  return new Promise(function (resolve, reject) {
    var read = 0;
    var rs = fs.createReadStream(file, {
      highWaterMark: 65536,
      flags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    });
    rs.on("data", function (chunk) {
      read += chunk.length;
      if (!res.write(chunk)) rs.pause();
    });
    res.on("drain", function () {
      rs.resume();
    });
    rs.on("end", function () {
      if (read !== size) {
        reject(new Error("Recording read interrupted"));
        return;
      }
      if (pad) res.write(Buffer.alloc(pad));
      resolve();
    });
    rs.on("error", reject);
  });
}
module.exports = {
  bundle: async function (res, files) {
    for (var i = 0; i < files.length; i++) {
      var item = await entry(files[i].path, files[i].name);
      res.write(header(item.name, item.size));
      await writeFile(res, item.file, item.size, item.pad);
    }
    res.write(Buffer.alloc(1024));
  },
};
