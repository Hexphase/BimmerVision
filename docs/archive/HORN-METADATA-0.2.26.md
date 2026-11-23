# Horn recording metadata — 0.2.26

The BasicDataSet horn-button definition exists but delivered no live values during the parked test, including user horn presses. Version 0.2.26 adds the independently verified BDC diagnostic button status instead.

The existing read-only BDC helper now serializes mirror reads (22D347) and horn-button reads (22D297). Only one diagnostic request may be outstanding, including when a negative response omits its identifier. Mirror reads retain priority. Horn reads request no faster than every 100 ms; timeouts stop the transport before reconnect, and an unsupported identifier backs off. No horn-control/write service is invoked. No additional helper process is created.

BVR metadata contains `horn` events with `pressed`, raw response, diagnostic source, observation timestamp, and round-trip time. The corresponding `telemetry.fields.horn` uses the existing two-second validity limit. Unknown, rejected, timed-out and stopped sampling invalidate the source rather than reporting released. The recording schema includes the diagnostic definition.

These are sampled observations, not exact physical switch-edge timestamps. On this car, observed native-proxy sample spacing was approximately 0.2–0.6 seconds (maximum 602547 microseconds in the inspected window), with maximum round-trip 306 ms. A short tap between samples may be missed; the 100 ms field is the nominal minimum request interval, not a guaranteed sampling rate.

## Validation

- BDC read 22D297 returned 62D29700 at rest, and both user-operated held presses matched 0→1→0 in the direct read-only probe.
- 0.2.26 app and recorder installed locally through mgu-deploy, preserving recording enabled. All 89 installed runtime/app JS hashes matched.
- The user's subsequent horn test appeared in actual BVR metadata: 78 horn samples, released→pressed→released→pressed→released, and 1114 telemetry snapshots with horn state in the inspected window. Metadata record checksums passed; no horn-unavailable events occurred in that window.
- Recording remained enabled. The metadata-inspection window had zero application drops and zero observed RTP sequence gaps. A later status still had zero application drops, but four observed RTP sequence gaps; native receiver losses remain unknown. Do not claim the entire session had zero transport gaps.
- The horn-test recording finalized naturally (stopReason=segment), complete=true, with 242000 video packets, zero application drops and four observed RTP sequence gaps. Recording continued into the next segment.
- The pre-update recording finalized with complete=true and stopReason=shutdown before the service resumed. Original installed 0.2.24 and 0.2.25 plus settings are privately backed up locally for rollback; no car credentials are included in release packages.
- 202 automated tests passed, including serialization, timeouts, malformed/denied responses, freshness and real BVR round-trip. Native decoder sanitizer and process checks passed with the unchanged 0.2.25 decoder.

0.2.26 is a local car update. No GitHub publication was performed during this follow-up.
