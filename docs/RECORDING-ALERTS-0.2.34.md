# Recording alerts — local app 0.2.34

The existing BMW HMI recording alert now covers degraded recording as well as
interruption. The recording pipeline, icons and saved recording preference remain unchanged. Recorder 0.2.31 remains required and byte-identical.
The Settings page reads the app package version and therefore displays 0.2.34.

With recording enabled:

- Storage full, unavailable/missing USB, or unresolved drive selection becomes
  alert-eligible after two seconds. Alerts tell the user to check the USB when
  parked. A stale recorder heartbeat instead reports an unresponsive recorder.
- New application packet drops can raise a quality warning while writes continue.
  This reports lost video rather than incorrectly calling recording stopped.
- A write queue at least half full for two seconds can raise a USB backlog warning.
  Transient backlog and backlog resolved during the cooldown stay quiet.
- Existing generic interruption, startup/setup grace, stable-progress recovery,
  delivery retry and intentional Pause behavior remain. Quality notifications
  have independent two-minute cooldowns and ten-second delivery retries; they
  cannot suppress or delay recording-interrupted notifications.

These alerts use the existing application's HMI overlay and 500 ms monitor. They
do not perform USB I/O or start/stop recording. Notification delivery requires
BimmerVision's app and BMW's HMI to be running; an app/head-unit crash cannot be
covered by an in-process monitor. One notification per ongoing outage and the
existing interruption cooldown prevent repeated banners. Drop warnings reflect
application-reported packet loss; no claim is made that all possible recording
corruption or native packet loss can be detected.

Validation: five new regression cases failed before implementation, passed
afterward; full npm test passed 271/271 after building release assets. The first
full-suite attempt preceded packaging and failed because the newly versioned
archive did not exist; build followed by the full suite passed. Build preserves
the approved Store and Apps icon hashes. Recorder package SHA-256 remains
1407e689e58f4d85d2595833565b87520b6c4bfd939d76cd5ebb255a77786022.

Prepared offline only: no car installation, banner visual verification or public
publication. The rollback is the retained app 0.2.33 package with the same
recorder 0.2.31. Do not reinstall/restart the recorder just for this app update.
