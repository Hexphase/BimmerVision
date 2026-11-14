"use strict";
var fs=require("fs"),path=require("path"),crypto=require("crypto");
var bytes=fs.readFileSync(path.join(__dirname,"store-package.tgz"));
if(crypto.createHash("sha256").update(bytes).digest("hex")!=="0685dc59131900a100e213d5f0d836a3247b1517624c0abcd04e2af9fd6abb39")throw Error("BimmerVision package checksum mismatch");
fs.writeFileSync(path.join(__dirname,"store-output.tgz"),bytes);
