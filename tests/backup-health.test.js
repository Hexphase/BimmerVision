"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { RecordingHealth } = require("../idrive/src/recording-health");
test("fresh intentional backup pause is silent but stale recorder heartbeat still triggers a warning", () => {
  const h = new RecordingHealth(),
    intent = { continuous: true };
  let now = 0;
  const status = {
    state: "Recording paused for remote backup",
    recordingPausedForBackup: true,
    backup: { configured: true, autoUpload: true, pauseRecording: true },
    heartbeatMonotonicUs: 0,
  };
  for (now = 0; now < 60000; now += 1000) {
    status.heartbeatMonotonicUs = now * 1000;
    assert.equal(h.update(status, intent, now), null);
  }
  let notice = null;
  for (; now < 90000; now += 1000)
    notice = h.update(status, intent, now) || notice;
  assert.equal(notice.kind, "interrupted");
});
