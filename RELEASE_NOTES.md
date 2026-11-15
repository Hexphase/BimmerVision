# BimmerVision 0.2.24 — testing prerelease

Continuous recording of BMW’s 360° cameras directly to USB on iDrive 7, plus live side-camera views in the instrument cluster when you signal.

- **Cluster cameras** has its own switch below Enable/Pause recording. Recording and preview work independently, with recording taking priority.
- See the front camera between signals, or enable **Only blinker cameras** to show side views only while signaling.
- Choose **Always**, **Blinkers only**, or **Off** for camera views during navigation.
- A new BimmerVision hardware preview decoder and renderer client use bounded queues, paced frames and camera fades. Each switch uses a fresh camera image while background layers retain the cluster's Map area.
- Includes the phone connection/playback fixes and persistent recording preferences from the development updates.

## Install this test update

1. In MGU Store, add this prerelease catalog as a URL source: [0.2.24 test catalog](https://github.com/Hexphase/BimmerVision/releases/download/v0.2.24/catalog.json).
2. Install or update **BimmerVision** from that source. Its matching **BimmerVision Recorder 0.2.24** companion is required; the catalog declares it as an automatic dependency.
3. Keep **Cluster renderer 0.6.0+** installed separately. Add [robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps) as a Store source if it is unavailable.
4. Keep the car parked for the first camera check. Select Map in the cluster, enable Cluster cameras, then check front/left/right/cancel and recording status.

The release also includes both matching install packages for manual installation. Keep the app and recorder on the same version.

## Validation

**Hardware testing is pending.** 194 automated tests pass, native host tests pass under sanitizers, and the Linux decoder builds reproducibly. The new decoder has not yet run on BMW hardware, so camera appearance, camera order, smoothness, sustained performance and recording/phone concurrency still need vehicle validation. Compatible iDrive 7 MGU with 360° Surround View is required; iDrive 8 is untested.

Keep your current app and recorder packages for rollback. This testing prerelease does not replace the stable Store catalog. Updating does not erase your USB recordings.

## Cluster renderer

Cluster camera display uses the separately downloaded [Cluster renderer](https://github.com/robertnisipeanu/idrive-apps). It is required and must remain installed.

# BimmerVision 0.2.23

BimmerVision is the first app to enable continuous recording of BMW’s 360° camera system directly to a USB flash drive on iDrive 7. This update also integrates live cameras in the instrument cluster: use the left or right blinker to see the matching side camera, with fades between views.

- **Cluster cameras** has its own On/Off control directly below Enable/Pause recording. Recording and preview work independently; recording always takes priority.
- Use the front camera between signals, or enable **Only blinker cameras** to keep the Map visible until you signal, regardless of navigation.
- Choose **Always**, **Blinkers only**, or **Off** while navigating. Off hides every cluster camera during navigation.
- Bounded preview queues, a separate low-priority decoder, coalesced camera selection and paced 15 FPS output handle rapid switching and varying frame arrival times.
- Connect Phone stays available with cluster preview enabled. Library loading and phone playback were confirmed stable on the test car after fixing session expiry and server cleanup races.
- Recording preferences persist across head-unit restarts. Direct capture requests the camera stream without using BMW’s Drive Recorder subscription service or performing a subscription check.
- Playback handles parking-camera takeovers, and the phone player supports downloading original recordings with metadata. Recording slowdown notices and interruption/recovery notifications are included.

## Requirements and installation

For compatible **iDrive 7 MGU** cars with **360° Surround View**. A rear camera alone is insufficient; iDrive 8 and other head units are untested. Recording needs a writable USB drive; preview does not.

**Cluster renderer (`cluster-render`) 0.6.0+ is required for cluster cameras.** Add `robertnisipeanu/idrive-apps` as a source in MGU Store if it cannot resolve this dependency. BimmerVision’s recorder companion is installed automatically.

Add `Hexphase/BimmerVision` in MGU Store, then install or update BimmerVision and its matching recorder companion together. Select Map in the cluster and turn on Cluster cameras in BimmerVision.

## Validation and limits

169 automated tests pass. On the project’s car, the owner confirmed camera switching/fades, independent recording and preview, navigation policies, blinker-only mode, and phone connection/playback with preview enabled. The latest preview pacing was benchmarked while parked; a full road test of that pacing and a complete head-unit sleep/wake cycle remain unverified. Occasional preview hitches may remain; saved recording playback was reported smooth.

The tested vehicle has an activated BMW Drive Recorder entitlement. Recording was verified with the official Drive Recorder disabled and suspended, but a vehicle without an entitlement has not yet been physically tested. Compatibility depends on vehicle hardware and software.

## Rollback

Keep the previous release’s app and recorder packages and `CAR-SHA256SUMS`. Turn cluster cameras off, then reinstall both matching packages from that release through MGU Store. Updating or rolling back does not erase USB recordings. The previous public release is [0.2.8](https://github.com/Hexphase/BimmerVision/releases/tag/v0.2.8); it does not have integrated cluster cameras.

# BimmerVision 0.2.18

- Enable and Pause recording are saved persistently and survive head-unit restarts.
- A missing preference consistently displays Enable recording and stays paused until enabled; the first press enables recording.
- Existing explicit recording preferences migrate during upgrade. Phone pairing and erase commands remain temporary.

# BimmerVision 0.2.12

- Recorded parking/front-wide/rear-wide camera takeovers play as intact images with one matching label, instead of being split into four labelled camera tiles. Normal recorder mode restores the selected camera layout.
- Camera view labels follow archived timestamps during playback and seeking. The camera selector and calibration action are unavailable during a takeover.
- Camera state is seeded at each new recording segment. Unknown state displays a generic raw view; legacy recordings without camera-state metadata retain their existing mapping.
- Temporary camera-status gaps recover when the same mode is observed again. A seek into the brief interval before a new mode's first frame shows a labelled blank rather than a stale image or a timeout.
- Retain the recording/download notice, native camera activation, and existing blind-spot/sign metadata. No camera-request or transfer-pacing policy changes.

This update is for the web player served directly by the car. The separate hosted viewer, Mac preview and export compositor are unchanged.
