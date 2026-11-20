"use strict";
const fs=require("fs"),path=require("path"),cp=require("child_process"),crypto=require("crypto");
const root=path.resolve(__dirname,".."),source=path.join(root,"recorder/native/backup-wifi-curl.c"),output=path.join(root,"recorder/files/backup-wifi-curl");
const zig=process.env.BV_ZIG||"zig",version=cp.execFileSync(zig,["version"],{encoding:"utf8"}).trim();
if(version!=="0.14.1")throw Error("Use Zig 0.14.1 for the Wi-Fi launcher");
const flags=["cc","-target","x86_64-linux-musl","-Os","-static","-s","-Wall","-Wextra","-Werror"];
cp.execFileSync(zig,flags.concat([source,"-o",output]),{stdio:"inherit"});fs.chmodSync(output,0o755);
const hash=p=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
fs.writeFileSync(path.join(root,"recorder/files/backup-network-provenance.json"),JSON.stringify({source:"recorder/native/backup-wifi-curl.c",sourceSha256:hash(source),sha256:hash(output),compiler:"Zig "+version,flags,platform:"Linux x86-64, static musl",privileges:"Root launcher; drops to dedicated backup UID with only CAP_NET_RAW; no setuid bit"},null,2)+"\n");
