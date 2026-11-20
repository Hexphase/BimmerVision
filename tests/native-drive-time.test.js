"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {format}=require("../idrive/src/drive-time");
test("native drive times use configured timezone with daylight saving and date rollover",()=>{
 assert.match(format("2026-11-17T13:29:11.982Z","America/Chicago"),/Nov 17, 7:29 AM/);
 assert.match(format("2026-07-17T13:30:00Z","America/Chicago"),/Jul 17, 8:30 AM/);
 assert.match(format("2026-11-17T02:30:00Z","America/Chicago"),/Nov 16, 8:30 PM/);
});
test("unknown timezone explicitly labels UTC and invalid recording dates stay unavailable",()=>{
 assert.match(format("2026-11-17T13:29:11Z"),/1:29 PM UTC/);
 assert.match(format("2026-11-17T13:29:11Z","bad/zone"),/1:29 PM UTC/);
 assert.equal(format(null,"America/Chicago"),"Recorded drive");
 assert.equal(format("invalid","America/Chicago"),"Recorded drive");
});
