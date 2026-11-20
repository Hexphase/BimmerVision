"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events"),
  { PassThrough } = require("node:stream");
const { Transport } = require("../recorder/files/backup-http");
function network() {
  return {
    snapshot: async () => ({
      eligible: true,
      interface: "wlan0",
      serviceId: "Home",
      address: "192.168.1.4",
    }),
    subscribe: () => () => {},
  };
}
test("backup transport refuses arbitrary destinations and missing Wi-Fi", async () => {
  const t = new Transport({ network: network() });
  await assert.rejects(
    t.request({ url: "https://evil.example/upload" }),
    /destination/,
  );
  const off = new Transport({
    network: { snapshot: async () => ({ eligible: false }) },
  });
  await assert.rejects(
    off.request({ url: "https://www.googleapis.com/drive/v3/about" }),
    /Wi-Fi/,
  );
});
test("transport binds interface and encrypted DNS, hides credentials from process args", async () => {
  let args,
    config = "",
    allConfig = "";
  const t = new Transport({
    network: network(),
    identity: () => ({uid:process.getuid(),gid:process.getgid()}),
    spawn: (file, a) => {
      args = a;
      const p = new EventEmitter();
      p.stdin = new PassThrough();
      p.stdout = new PassThrough();
      p.stderr = new PassThrough();
      p.stdio = [p.stdin, p.stdout, p.stderr, new PassThrough()];
      p.kill = () => {};
      p.stdin.on("data", (b) => {
        config += b;
        allConfig += b;
      });
      p.stdin.on("finish", () =>
        setImmediate(() => {
          const dns = config.includes("/dns-query?");
          p.stdout.end(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n" +
              (dns
                ? JSON.stringify({
                    Status: 0,
                    Answer: [{ type: 1, data: "142.250.1.1", TTL: 30 }],
                  })
                : "{}"),
          );
          config = "";
          p.emit("close", 0);
        }),
      );
      return p;
    },
  });
  const r = await t.request({
    url: "https://www.googleapis.com/drive/v3/about",
    headers: { Authorization: "Bearer private-token" },
  });
  assert.equal(r.status, 200);
  assert.ok(allConfig.includes("if!wlan0"));
  assert.ok(allConfig.includes("https://1.1.1.1/dns-query"));
  assert.ok(allConfig.includes("private-token"));
  assert.ok(!JSON.stringify(args).includes("private-token"));
  assert.ok(allConfig.includes("noproxy"));
  assert.ok(allConfig.includes("backup-ca-bundle.pem"));
  assert.ok(!allConfig.includes("insecure"));
  t.close();
});
test("encrypted DNS is a separately interface-bound request and Google uses the resolved IP", async () => {
  const configs = [];
  const t = new Transport({
    network: network(),
    identity: () => ({uid:process.getuid(),gid:process.getgid()}),
    spawn: () => {
      let config = "";
      const p = new EventEmitter();
      p.stdin = new PassThrough();
      p.stdout = new PassThrough();
      p.stderr = new PassThrough();
      p.stdio = [p.stdin, p.stdout, p.stderr, new PassThrough()];
      p.kill = () => {};
      p.stdin.on("data", (b) => (config += b));
      p.stdin.on("finish", () =>
        setImmediate(() => {
          configs.push(config);
          const body = config.includes("/dns-query?")
            ? JSON.stringify({
                Status: 0,
                Answer: [{ type: 1, data: "142.250.1.1", TTL: 30 }],
              })
            : "{}";
          p.stdout.end("HTTP/1.1 200 OK\r\n\r\n" + body);
          p.emit("close", 0);
        }),
      );
      return p;
    },
  });
  await t.request({ url: "https://www.googleapis.com/drive/v3/about" });
  assert.equal(configs.length, 2);
  assert.ok(configs.every((x) => x.includes("if!wlan0")));
  assert.ok(configs[1].includes("www.googleapis.com:443:142.250.1.1"));
  assert.ok(!configs[1].includes("doh-url"));
  t.close();
});
test("curl receives request bodies through a regular descriptor, not an unopenable socket path", async () => {
  const fs = require("node:fs");
  let bodyRead = false;
  const t = new Transport({
    network: network(),
    identity: () => ({uid:process.getuid(),gid:process.getgid()}),
    spawn: (file, args, options) => {
      let config = "";
      const p = new EventEmitter();
      p.stdin = new PassThrough();
      p.stdout = new PassThrough();
      p.stderr = new PassThrough();
      p.stdio = [p.stdin, p.stdout, p.stderr, null];
      p.kill = () => {};
      if (typeof options.stdio[3] === "number") {
        assert.equal(fs.fstatSync(options.stdio[3]).isFile(), true);
        assert.equal(fs.readFileSync(options.stdio[3], "utf8"), "request-body");
        bodyRead = true;
      }
      p.stdin.on("data", (b) => (config += b));
      p.stdin.on("finish", () =>
        setImmediate(() => {
          p.stdout.end(
            "HTTP/1.1 200 OK\r\n\r\n" +
              (config.includes("/dns-query?")
                ? JSON.stringify({
                    Status: 0,
                    Answer: [{ type: 1, data: "142.250.1.1", TTL: 30 }],
                  })
                : "{}"),
          );
          p.emit("close", 0);
        }),
      );
      return p;
    },
  });
  await t.request({
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    body: "request-body",
  });
  assert.equal(bodyRead, true);
  t.close();
});
test("backup uses only the Wi-Fi launcher and owns body descriptors as its isolated identity",async()=>{
 const fs=require("node:fs");let launched=false;
 const t=new Transport({network:network(),identity:()=>({uid:process.getuid(),gid:process.getgid()}),spawn:(file,args,options)=>{
  launched=true;assert.match(file,/backup-wifi-curl$/);assert.deepEqual(args,["wlan0"]);
  if(typeof options.stdio[3]==="number")assert.equal(fs.fstatSync(options.stdio[3]).uid,process.getuid());
  const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{};
  p.stdin.on("finish",()=>setImmediate(()=>{p.stdout.end("HTTP/1.1 200 OK\r\n\r\n{}");p.emit("close",0);}));return p;
 }});
 await t.exchange({url:"https://oauth2.googleapis.com/token",method:"POST",body:"body"},await network().snapshot(),null);assert.equal(launched,true);
 const blocked=new Transport({network:network(),identity:()=>{throw Error("bad identity");},spawn:()=>{throw Error("must not spawn");}});
 await assert.rejects(blocked.exchange({url:"https://oauth2.googleapis.com/token"},await network().snapshot(),null),/network identity/);
});
test("Wi-Fi loss aborts the request instead of continuing over another uplink",async()=>{
 let changed,started,child;
 const online={eligible:true,interface:"wlan0",address:"192.168.1.4",serviceId:"Home"};
 const gate={snapshot:async()=>online,subscribe:fn=>{changed=fn;return ()=>{};}};
 const ready=new Promise(resolve=>{started=resolve;});
 const t=new Transport({network:gate,identity:()=>({uid:process.getuid(),gid:process.getgid()}),spawn:()=>{
  child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;child.kill=()=>{child.killed=true;child.signalCode="SIGTERM";};child.stdin.on("finish",started);return child;
 }});
 const request=t.exchange({url:"https://oauth2.googleapis.com/device/code"},online,null);
 const rejected=assert.rejects(request,/interrupted/);await ready;changed({eligible:false,interface:"wwan0"});await rejected;assert.equal(child.killed,true);t.close();
});
test("upload body permission is rechecked after asynchronous network validation before spawning curl",async()=>{
 let allowed=true,spawns=0;
 const t=new Transport({network:{snapshot:async()=>{allowed=false;return {eligible:true,interface:"wlan0",serviceId:"Home",address:"192.168.1.4"};}},uploadPermitted:()=>allowed,identity:()=>({uid:process.getuid(),gid:process.getgid()}),spawn:()=>{spawns++;throw Error("should not spawn");}});
 await assert.rejects(t.exchange({url:"https://www.googleapis.com/upload/drive/v3/files",method:"PUT",body:Buffer.from("video"),uploadBody:true}),/stationary/);assert.equal(spawns,0);
});
test('connected viewer blocks all car cloud metadata and DNS as well as uploads',async()=>{let calls=0;const t=new Transport({network:network(),requestPermitted:()=>false,spawn:()=>{calls++;throw Error('must not spawn');}});for(const request of [{url:'https://www.googleapis.com/drive/v3/about'},{url:'https://www.googleapis.com/drive/v3/files/generateIds'},{url:'https://oauth2.googleapis.com/token',method:'POST'}])await assert.rejects(t.request(request),/Phone connected/);await assert.rejects(t.exchange({url:'https://1.1.1.1/dns-query'},null,null),/Phone connected/);assert.equal(calls,0);});
