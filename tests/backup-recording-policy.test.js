"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  RecordingPolicy,
} = require("../recorder/files/backup-recording-policy");
function state() {
  return {
    intent: { continuous: true, recordingAction: "a" },
    backup: {
      configured: true,
      autoUpload: true,
      pauseRecording: true,
      speedPermitted: true,
      stationaryPermitted: true,
      pending: true,
      state: "Uploading",
      wifi: { eligible: true },
    },
    vehicle: {
      validated: true,
      parked: true,
      driving: false,
      driveReady: false,
      speedKph: 0,
      atUs: 1000000,
    },
    nowUs: 1000000,
  };
}
test("recording pauses only while stationary, independently of upload permission or gear",()=>{
 const p=new RecordingPolicy(),s=state();
 assert.equal(p.evaluate(s).temporaryPause,true);
 for(const vehicle of [{parked:false,driving:true,driveReady:true,speedKph:5},{}])assert.equal(p.evaluate({...s,vehicle}).temporaryPause,true);
 for(const stationaryPermitted of [false,undefined])assert.equal(p.evaluate({...s,backup:{...s.backup,stationaryPermitted}}).effectiveContinuous,true);
 assert.equal(p.evaluate({...s,backup:{...s.backup,speedPermitted:false}}).temporaryPause,true);
 assert.equal(p.evaluate({...s,backup:{...s.backup,pending:false}}).effectiveContinuous,true);
 assert.equal(p.evaluate({...s,backup:{...s.backup,pauseRecording:false}}).effectiveContinuous,true);
});
test("full Drive, lost Wi-Fi and user changes release automatic pause without rewriting intent", () => {
  const p = new RecordingPolicy(),
    s = state();
  assert.equal(p.evaluate(s).temporaryPause, true);
  assert.equal(
    p.evaluate({ ...s, backup: { ...s.backup, storageFull: true } })
      .temporaryPause,
    false,
  );
  assert.equal(
    p.evaluate({ ...s, backup: { ...s.backup, wifi: { eligible: false } } })
      .temporaryPause,
    false,
  );
  p.evaluate(s);
  assert.equal(
    p.evaluate({
      ...s,
      intent: { continuous: true, recordingAction: "manual" },
    }).temporaryPause,
    false,
  );
  assert.equal(
    p.evaluate({ ...s, intent: { continuous: false, recordingAction: "off" } })
      .effectiveContinuous,
    false,
  );
});
test("manual resume remains effective across a transient queue scan", () => {
  const p = new RecordingPolicy(),
    s = state();
  assert.equal(p.evaluate(s).temporaryPause, true);
  s.intent.recordingAction = "manual";
  assert.equal(p.evaluate(s).temporaryPause, false);
  p.evaluate({ ...s, backup: { ...s.backup, pending: false } });
  assert.equal(p.evaluate(s).temporaryPause, false);
});
test("recording backpressure can initiate the checkbox pause only when speed permits uploads",()=>{
 const p=new RecordingPolicy(),s=state();s.backup.state="Recording takes priority";
 assert.equal(p.evaluate(s).temporaryPause,true);
 s.backup.stationaryPermitted=false;assert.equal(p.evaluate(s).temporaryPause,false);
});
test('explicit phone work can pause capture on its paired LAN without enabling automatic backup',()=>{const p=new RecordingPolicy(),s=state();s.backup.autoUpload=false;s.backup.wifi={eligible:false};s.backup.phone={active:true,pending:1};s.backup.state='Phone upload active';assert.equal(p.evaluate(s).temporaryPause,true);assert.equal(s.backup.autoUpload,false);assert.equal(s.backup.wifi.eligible,false);s.backup.stationaryPermitted=false;assert.equal(p.evaluate(s).temporaryPause,false);s.backup.stationaryPermitted=true;s.backup.phone.active=false;assert.equal(p.evaluate(s).temporaryPause,false);});
test('durable manual phone fallback can pause capture when real station Wi-Fi becomes eligible',()=>{const p=new RecordingPolicy(),s=state();s.backup.autoUpload=false;s.backup.phone={active:false,pending:1};assert.equal(p.evaluate(s).temporaryPause,true);s.backup.phone.pending=0;assert.equal(p.evaluate(s).temporaryPause,false);});
