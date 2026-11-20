"use strict";
function RecordingPolicy() {
  this.lastAction = null;
  this.blockedAction = null;
  this.paused = false;
}
RecordingPolicy.prototype.evaluate = function (input) {
  var intent = input.intent || {},
    backup = input.backup || {},
    action = intent.recordingAction || "initial",
    phone = backup.phone || {},
    workEnabled = backup.autoUpload === true || phone.active === true || phone.pending > 0,
    networkEligible = !!(backup.wifi && backup.wifi.eligible === true) || phone.active === true;
  if (this.paused && this.lastAction !== action) this.blockedAction = action;
  this.lastAction = action;
  if (
    backup.state === "Up to date" ||
    !workEnabled ||
    !backup.pauseRecording
  )
    this.blockedAction = null;
  var valid = backup.stationaryPermitted === true;
  var working = /^(Uploading|Verifying|Queued|Preparing|Recording takes priority|Phone upload active)$/.test(
    backup.state || "",
  );
  var pause =
    intent.continuous === true &&
    backup.configured === true &&
    workEnabled &&
    backup.pauseRecording === true &&
    backup.pending === true &&
    networkEligible &&
    !backup.storageFull &&
    working &&
    valid &&
    this.blockedAction !== action;
  this.paused = !!pause;
  return {
    effectiveContinuous: intent.continuous === true && !pause,
    temporaryPause: !!pause,
    reason: pause
      ? "Recording paused for remote backup"
      : !valid && backup.pauseRecording
        ? "Automatic recording pause waits until the car is stationary"
        : "",
  };
};
module.exports = { RecordingPolicy: RecordingPolicy };
