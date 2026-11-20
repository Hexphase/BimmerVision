"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {ensure}=require("../recorder/files/backup-network-identity");
test("backup gets a persisted UID outside OEM ranges and existing service identities",async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"bv-netuid-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dirs={base:path.join(root,"recorder"),etcDir:path.join(root,"etc"),oapRoot:path.join(root,"oap"),procRoot:path.join(root,"proc"),uplinkRoot:path.join(root,"uplink"),toolRoot:path.join(root,"tools")};
 for(const p of Object.values(dirs))fs.mkdirSync(p,{recursive:true});
 fs.writeFileSync(path.join(dirs.etcDir,"passwd"),"other:x:12701:12701:::\n");fs.writeFileSync(path.join(dirs.etcDir,"group"),"other:x:12702:\n");
 const config=path.join(root,"main.json");fs.writeFileSync(config,JSON.stringify({usableUidsAndGids:{min:12203,max:12700},mainAppUids:[12201]}));
 fs.mkdirSync(path.join(dirs.uplinkRoot,"uids.d"));fs.writeFileSync(path.join(dirs.uplinkRoot,"uids.d/other"),"12703\n");
 fs.mkdirSync(path.join(dirs.procRoot,"1"));fs.writeFileSync(path.join(dirs.procRoot,"1/status"),"Uid:\t12704\t12704\t12704\t12704\nGid:\t12704\t12704\t12704\t12704\n");
 const options={...dirs,mainappFiles:[config]};const uid=await ensure(options);assert.equal(uid,12705);assert.equal(await ensure(options),uid);
 const file=path.join(dirs.base,"data/backup-network-uid");assert.equal(fs.readFileSync(file,"utf8"),"12705\n");assert.equal(fs.statSync(file).mode&0o777,0o600);
 fs.appendFileSync(path.join(dirs.etcDir,"passwd"),"collision:x:12705:12705:::\n");await assert.rejects(ensure(options),/identity.*collision/i);
 fs.unlinkSync(file);fs.symlinkSync(path.join(root,"target"),file);await assert.rejects(ensure(options),/unsafe/i);
});
test("missing OEM identity ranges fails closed",async()=>{await assert.rejects(ensure({mainappFiles:["/nonexistent/bv-main-config"]}),/OEM.*range/);});
test("persisted backup identity rejects a new unrelated live process using its UID",async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),"bv-netuid-live-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const base=path.join(root,"recorder"),procRoot=path.join(root,"proc"),config=path.join(root,"main.json");
 fs.mkdirSync(procRoot,{recursive:true});fs.writeFileSync(config,JSON.stringify({usableUidsAndGids:{min:12203,max:12700}}));
 const o={base,procRoot,mainappFiles:[config],etcDir:path.join(root,"etc"),oapRoot:path.join(root,"oap"),toolRoot:path.join(root,"tools"),uplinkRoot:path.join(root,"uplink")};
 const uid=await ensure(o);const p=path.join(procRoot,"42");fs.mkdirSync(p);fs.writeFileSync(path.join(p,"status"),`Uid:\t${uid}\t${uid}\t${uid}\t${uid}\nGid:\t${uid}\t${uid}\t${uid}\t${uid}\nGroups:\t\nCapEff:\t0000000000002000\nCapAmb:\t0000000000002000\nNoNewPrivs:\t1\n`);
 fs.symlinkSync("/usr/bin/curl",path.join(p,"exe"));fs.writeFileSync(path.join(p,"cgroup"),"1:name=systemd:/system.slice/unrelated.service\n");
 await assert.rejects(ensure(o),/identity.*collision/i);
 fs.writeFileSync(path.join(p,"cgroup"),"1:name=systemd:/system.slice/bimmervision-recorder.service\n");
 assert.equal(await ensure(o),uid,"our existing isolated curl worker may finish during activation");
});
