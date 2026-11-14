"use strict";
// qrcode-generator 1.4.4, MIT; retained native QR frame format.
var zlib = require("zlib"),
  generator = require("./vendor/qrcode-generator");
function encode(text) {
  var q = generator(0, "M");
  q.addData(String(text), "Byte");
  q.make();
  var size = q.getModuleCount(),
    modules = [];
  for (var y = 0; y < size; y++) {
    var row = [];
    for (var x = 0; x < size; x++) row.push(q.isDark(y, x) ? 1 : 0);
    modules.push(row);
  }
  return { size: size, modules: modules };
}
function frame(text) {
  var code = encode(text);
  var quiet = 4;
  var span = code.size + quiet * 2;
  var scale = Math.floor(640 / span);
  if (scale < 4) scale = 4;
  var dim = span * scale;
  if (dim % 2) dim -= 1;
  var pixels = Buffer.alloc((dim * dim * 3) / 2);
  pixels.fill(255, 0, dim * dim);
  pixels.fill(128, dim * dim);
  function mark(x, y) {
    var yy;
    var xx;
    for (yy = 0; yy < scale; yy++) {
      var row = y * scale + yy;
      if (row >= dim) continue;
      for (xx = 0; xx < scale; xx++) {
        var col = x * scale + xx;
        if (col < dim) pixels[row * dim + col] = 0;
      }
    }
  }
  var y;
  var x;
  for (y = 0; y < code.size; y++) {
    for (x = 0; x < code.size; x++) {
      if (code.modules[y][x]) mark(x + quiet, y + quiet);
    }
  }
  var header = Buffer.alloc(64);
  header.writeUInt32LE(0x4656474d, 0);
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(dim, 8);
  header.writeUInt32LE(dim, 12);
  header.writeUInt32LE(1, 16);
  header.writeUInt32LE(1, 24);
  header.writeUInt32LE(1, 32);
  return Buffer.concat([header, pixels]);
}
function crc32(buf) {
  var c = -1;
  for (var i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (var k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  var body = Buffer.concat([Buffer.from(type), data]),
    len = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  sum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, sum]);
}
function png(text) {
  var code = encode(text),
    scale = 6,
    quiet = 4,
    span = code.size + quiet * 2,
    dim = span * scale,
    raw = Buffer.alloc((dim + 1) * dim),
    y,
    x;
  for (y = 0; y < dim; y++) {
    var row = y * (dim + 1);
    raw[row] = 0;
    for (x = 0; x < dim; x++) {
      var mx = Math.floor(x / scale) - quiet,
        my = Math.floor(y / scale) - quiet,
        dark =
          my >= 0 &&
          mx >= 0 &&
          my < code.size &&
          mx < code.size &&
          code.modules[my][mx];
      raw[row + 1 + x] = dark ? 0 : 255;
    }
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0);
  ihdr.writeUInt32BE(dim, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
module.exports = { encode: encode, frame: frame, png: png };
