# BimmerVision v0.2.2

## What's New in v0.2.2

### 🔍 Vehicle Perception & ADAS Metadata Capture
- **22 High-Frequency SOME/IP Perception Streams**: Real-time logging of surrounding vehicle positions, distance/gap to lead vehicles (`GapVehicleAhead`), lane boundaries, and camera object detection streams (`ObjectRecognitionFrontCamera2`) directly from the KAFAS camera system alongside existing video and vehicle telemetry.
- **Synchronized Capture Cadence**: Perception records are timestamped to the microsecond and committed synchronously with existing video frames and chassis telemetry without any overhead on the head unit CPU.

### 🛡️ Recording Lock Protection
- **Lock Clips & Entire Drives**: Users can now lock individual recordings or full drive sessions directly in the car's iDrive interface or the web companion.
- **Protected Erasure**: Erase / Drive Cleanup operations automatically preserve all locked recordings and their playback dependencies while safely freeing storage from unlocked clips.

### 🚗 Enhanced iDrive 7 MGU Native UI
- **Pulsing Recording Indicator**: High-visibility recording pulse on the head unit screen during active capture.
- **MGU Store Native Compatibility**: Packaged directly for one-tap discovery and updates via [robertnisipeanu/mgu-store](https://github.com/robertnisipeanu/mgu-store).
- **Settings Screen**: Displays installed iDrive version, web player version, and instructions for offline use at [bimmerdrive.app](https://bimmerdrive.app).

### 📱 Modernized Cockpit HUD & Web Player
- **Instrument Telemetry Bar**: Live bottom instrument HUD featuring accelerator and brake pedal meters, active turn indicators, steering wheel angle, and instantaneous speed.
- **Settings & Units**: Dedicated speed unit toggle (MPH vs. km/h) in settings.
- **Synchronized Map Route**: Interactive OpenStreetMap tracking alongside synchronized multi-camera playback.
- **High-Definition Composite MP4 Exporter**: Hardware-accelerated browser export combining all 4 camera perspectives, telemetry HUD, and route map into a single MP4 video.

---

## Release Assets & Checksums

| Asset | Size | SHA-256 Checksum |
| :--- | :--- | :--- |
| `masel_cameras@0.2.2.tgz` | 45,392 bytes | `e69d7ab36f1c31e3a7f5ae75dc84f494086cc51dbbdf3b05ee3a1f2fdc2aba81` |
| `BimmerVision-Car-0.2.2.tgz` | 1,744,737 bytes | `bc024e56e2c56c139d5fa2b2c6d88f93d238e1bf407ed43049729d7ea209386c` |
| `catalog.json` | 565 bytes | `b0e73ade881a48c09a4d9e5b961652b65b629eb9406a821cd403335a4b7743ef` |

---

## Installation via MGU Store

1. Open **MGU Store** on your BMW iDrive 7 head unit.
2. In **Settings → Add source**, enter:
   ```text
   Hexphase/BimmerVision
   ```
3. Tap **Install** on **BimmerVision**.

*For the background recording daemon (`BimmerVision-Car-0.2.2.tgz`), follow the SSH installation steps in the README.*

---

## Disclaimer

*BimmerVision is an independent open-source project developed by a hobbyist who loves BMW and software engineering. It is not affiliated with, endorsed by, or sponsored by Bayerische Motoren Werke AG (BMW). Use at your own risk. The developer assumes no liability for vehicle damage, warranty voidance, or accidents.*
