"use strict";
var fs = require("fs"), path = require("path"), crypto = require("crypto");
var source = path.join(__dirname, "store-package.tgz");
var bytes = fs.readFileSync(source);
if (crypto.createHash("sha256").update(bytes).digest("hex") !== "b15eae3ef79fd182486267659ee2146191a80631bb80a1d12a5ac150de754062") throw new Error("BimmerVision package checksum mismatch");
fs.writeFileSync(path.join(__dirname, "store-output.tgz"), bytes);
