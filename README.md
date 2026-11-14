# BimmerVision

BimmerVision records the car’s compressed camera stream and synchronized vehicle metadata to USB, with an iDrive interface and a mobile web player. **Currently supported and tested: iDrive 7 (MGU), Linux x86-64, with a supported camera stream.** Vehicle equipment still determines which camera views and signals are available.

## Install from MGU Store

1. Add the source **Hexphase/BimmerVision** in MGU Store.
2. Select **BimmerVision → Install**. The Store automatically includes its required **BimmerVision Recorder** companion. There is no separate companion download or SSH setup to perform.
3. If the Store or BimmerVision says **Restart iDrive to finish setup**, park the car and use the Store’s restart action. BimmerVision never restarts the head unit by itself.
4. Open BimmerVision. The recorder discovers the installed app’s identity, creates private certificates on this car, and validates the camera transport automatically. If the cameras are not producing a supported stream yet, setup waits and retries rather than reporting a working recorder.
5. Connect a writable USB drive. Use **Enable recording** to record, or **Connect Phone** to open the mobile player and pairing QR code.

Certificates, pairing credentials and camera enrollment stay on the individual car. None are included in the download. Updating the app also updates its required recorder; saved USB recordings are preserved. Removing BimmerVision through the Store can include its otherwise-unused recorder dependency; recordings on USB are not erased by removing the software.

## What is included

- Compressed camera capture without video re-encoding on the head unit.
- Existing driving telemetry and raw ADAS/perception metadata captured alongside recordings; the web player continues to display its existing telemetry fields.
- Locked recording protection, USB storage status, phone pairing, browser playback and export.
- A recorder bootstrap that handles app installation order, actual app UID, local TLS, runtime compatibility, camera readiness and supported legacy recorder migration.

The Store listing is **BimmerVision**. The separate listing icon is used before installation; this Store version uses the iDrive menu icon for installed apps.

## Build and verify

Requires a current Node.js version on the development computer, with no third-party npm dependencies:

```sh
npm test
npm run build
```

The release produces `bimmervision@0.2.5.tgz`, its required `bimmervision-recorder@0.2.5.tgz`, `catalog.json` and `CAR-SHA256SUMS`. `mgu-repo.json` provides the same dependency relationship for a GitHub branch source. Runtime code is compatible with the head unit’s Node 8 runtime. Development tests include installation order, UID changes, private credentials, unsupported/missing camera streams and restart status.

The recorder is installed and registered by the Store’s deployment tool. Do not manually start a newly installed recorder before its required recovery-manager restart. Older standalone `BimmerVisionService` bundles are retained for existing users but are not the new Store installation path.

## Project

Source: **Hexphase/BimmerVision**. Independent software, unaffiliated with BMW. Hardware and physical-car behavior beyond the tested iDrive 7 setup have not been certified. Operate recording and playback controls only when safe to do so.
