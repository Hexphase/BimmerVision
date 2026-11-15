# BimmerVision 0.2.36

Continuous recording of BMW’s 360° camera system to USB, with saved-video playback and export on your phone or computer.

- Removed live instrument-cluster camera views, their settings, decoder, workers, transport and renderer dependency.
- Preserved recording, phone connection, saved playback/export, telemetry, horn indicators and USB diagnostic logs.
- Includes alerts for recording interruptions, unavailable/full USB storage, dropped video and sustained USB write backlog.
- USB diagnostic logs are written only while recording is enabled. Pause cancels queued logging; existing logs are retained and still survive erasing recordings.
- Added a first-run camera-app conflict warning with an Understood acknowledgement saved locally, separate from USB logs.
- Preserved the approved Store and Apps page icon sizes.

Install app and recorder 0.2.36 together. Older saved preview settings are ignored. Existing recordings and recording preferences are preserved. BimmerVision no longer requires Cluster renderer; other installed applications may still use it.

Installed and verified on the test vehicle. The first-run warning and removal of camera controls were confirmed in-car; the automated suite passes all 180 tests. The complete pre-removal project and earlier packages are retained in a separately verified backup for future work or rollback.
