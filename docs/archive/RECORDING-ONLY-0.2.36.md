# Recording-only 0.2.36

Live instrument-cluster camera views have been removed from the app and recorder, including UI, preferences, native decoder, runtime workers, experiments and renderer dependency. Recording and saved-video playback/export, horn metadata, USB alerts and the approved icon sizes remain.

Old preview preferences cannot reactivate capture. Camera capture runs only while recording is requested. Existing recordings and recording intent are preserved.

USB diagnostics now start only when recording is enabled. Pausing cancels queued diagnostic writes and scheduled flushes; already-issued I/O may complete. Existing logs remain, survive recording erasure, and retain the 64 MiB cap. Logs can still describe recording failures while the feature remains enabled.

On first opening the app, a notice asks the user to disable other third-party camera apps to avoid incomplete camera capture. Understood saves a private local acknowledgement without changing recording intent or writing to USB.

Validation: all 180 automated tests pass. App and recorder 0.2.36 installed together with successful service health checks. Installed runtime/source hashes matched the packages. The user confirmed the warning and absence of live-camera controls. Twelve one-second paused samples showed no changes to USB log names, sizes or modification times. Subsequent recording status showed active capture, no error, zero application packet drops and zero service restarts at the observation time. These checks do not establish every vehicle or drive condition.

Update both components together. Keep previous app and recorder packages for rollback. Recordings are preserved by app updates. Shared renderer installations used by other apps are not removed.
