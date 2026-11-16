"use strict";
var fs=require("fs"),path=require("path"),crypto=require("crypto");
var bytes=fs.readFileSync(path.join(__dirname,"store-package.tgz"));
if(crypto.createHash("sha256").update(bytes).digest("hex")!=="146fb048be8c234852f2772c4aa1736ccd469e84805b1f44da5c6a442765cbbe")throw Error("BimmerVision package checksum mismatch");
fs.writeFileSync(path.join(__dirname,"store-output.tgz"),bytes);
