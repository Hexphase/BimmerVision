# BimmerVision v0.2.3

Fixes fresh Store installation and the missing initial QR graphic. The recorder companion remains a separate installation with vehicle enrollment and recovery setup.

> **Important Compatibility Notice:** This app has only been tested on **iDrive 7**.

---

## What's New in v0.2.3

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

| Asset | Size | SHA-256 Checksum | Description |
| :--- | :--- | :--- | :--- |
| `bimmervision@0.2.3.tgz` | 45,391 bytes | `b15eae3ef79fd182486267659ee2146191a80631bb80a1d12a5ac150de754062` | **iDrive 7 Front-End App** (installed by MGU Store) |
| `BimmerVisionService-0.2.3.tgz` | 1,729,888 bytes | `13bc1440040e4ec807c4780a92e88ea62febd5d8bbe0057d91b6cde4e0206d9e` | **BimmerVisionService Daemon** (Linux systemd recorder) |
| `catalog.json` | 575 bytes | `9cb570d24a3b5f33a40e3dcaf9bf9d9cc28cef5aae18ee94b8ec881476b6b877` | MGU Store Schema 2 catalog manifest |
| `mgu-repo.json` | 142 bytes | `be5fe69a5fd3f7c746fee8bb881a1f448f1863dba45fb8f15897770ef4854ea3` | MGU Store Repo Tree manifest |
| `CAR-SHA256SUMS` | 185 bytes | — | Checksum verification file for release archives |

---

## Installation via MGU Store

1. Open **MGU Store** on your BMW iDrive 7 head unit.
2. In **Settings → Add source**, enter:
   ```text
   Hexphase/BimmerVision
   ```
3. Tap **Install** on **BimmerVision**.

*For the background recording daemon (`BimmerVisionService-0.2.3.tgz`), follow the SSH installation steps in the README.*

---

## Disclaimer

*BimmerVision is an independent open-source project by Hexphase, developed by an automotive hobbyist. It is not affiliated with, endorsed by, or sponsored by Bayerische Motoren Werke AG (BMW). This app has only been tested on iDrive 7. Use at your own risk. The developer assumes no liability for vehicle damage, warranty voidance, or accidents.*
