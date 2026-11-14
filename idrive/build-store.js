"use strict";
var fs = require("fs"), path = require("path"), crypto = require("crypto");
var source = path.join(__dirname, "store-package.tgz");
var bytes = fs.readFileSync(source);
if (crypto.createHash("sha256").update(bytes).digest("hex") !== "e65f3b8f0bf10939984aa8bfd20bb169a965cb13b66cab442618711e174f6df7") throw new Error("BimmerVision package checksum mismatch");
fs.writeFileSync(path.join(__dirname, "store-output.tgz"), bytes);
