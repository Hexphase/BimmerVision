"use strict";
var fs=require("fs"),path=require("path"),crypto=require("crypto");
var bytes=fs.readFileSync(path.join(__dirname,"store-package.tgz"));
if(crypto.createHash("sha256").update(bytes).digest("hex")!=="7853697a2fadcff6743edfbbe43ac35abc0d5fca0f4d767388a57a8678b5cfe1")throw Error("BimmerVision package checksum mismatch");
fs.writeFileSync(path.join(__dirname,"store-output.tgz"),bytes);
