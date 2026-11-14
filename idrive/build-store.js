"use strict";
var fs = require("fs"), path = require("path"), crypto = require("crypto");
var source = path.join(__dirname, "store-package.tgz");
var bytes = fs.readFileSync(source);
if (crypto.createHash("sha256").update(bytes).digest("hex") !== "3a8e3ac3fd14ba7ba17b05c10b6e481d23a80b69a2d3ad756ca79d98a2255076") throw new Error("BimmerVision package checksum mismatch");
fs.writeFileSync(path.join(__dirname, "store-output.tgz"), bytes);
