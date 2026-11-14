# BimmerVision

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: BMW iDrive 7 (MGU)](https://img.shields.io/badge/Platform-BMW%20iDrive%207%20(MGU)-0066B2.svg)](https://github.com/robertnisipeanu/mgu-store)
[![Release: v0.2.3](https://img.shields.io/badge/Release-v0.2.3-brightgreen.svg)](https://github.com/Hexphase/BimmerVision/releases/tag/v0.2.3)

**BimmerVision** is a lightweight, zero-overhead multi-camera dashcam and synchronized vehicle telemetry recorder built natively for BMW vehicles equipped with **iDrive 7 (MGU)**.

Instead of bogging down the head unit CPU with real-time video decoding or re-encoding, BimmerVision captures camera streams directly from the vehicle's onboard Ethernet bus and commits them alongside high-frequency telemetry and ADAS perception metadata directly to a connected USB storage drive.

Recordings can be viewed, reviewed, and exported into composite 4-camera dashcam videos with a telemetry HUD using either the built-in mobile web app over Wi-Fi or offline via [bimmerdrive.app](https://bimmerdrive.app).

> [!IMPORTANT]
> **Compatibility Notice:** This app has only been tested on **iDrive 7**.

---

## Features

### 🚗 Native iDrive 7 App (MGU)
* **Seamless iDrive 7 Integration**: Installs directly onto rooted MGU head units via [robertnisipeanu/mgu-store](https://github.com/robertnisipeanu/mgu-store) or USB. Appears natively in the BMW apps menu with full iDrive Controller (rotary knob) navigation.
* **Recording Status & HUD Pulse**: Clean visual status widget showing active recording, recording duration, and memory utilization.
* **Storage & USB Management**: Automatic detection and mounting of high-speed USB flash drives, filesystem health checks, storage space breakdown, safe drive ejection, and one-click formatting.
* **Lock & Protect Recordings**: Lock individual clips or entire drives directly from the iDrive screen so critical moments cannot be accidentally overwritten or erased.
* **Instant QR Code Transfer**: Display an on-screen pairing QR code to immediately connect a phone, tablet, or laptop over the car's local Wi-Fi hotspot.

### 📹 Zero-Overhead Video & Telemetry Capture
* **Zero Re-encoding Overhead**: Intercepts H.264 camera streams directly from the onboard Ethernet network and writes them to USB without taxing the vehicle head unit CPU or thermal envelope.
* **Synchronized Vehicle Telemetry**: Simultaneously samples OEM SOME/IP vehicle signals:
  * Vehicle speed (instantaneous MPH / km/h)
  * Steering wheel angle (degrees & direction)
  * Accelerator pedal position (%)
  * Brake pedal application
  * Turn signals & hazard indicators
  * GPS coordinates (latitude, longitude)
* **ADAS Perception Metadata**: Captures 22 high-frequency perception streams from the KAFAS camera system, including distance and gap to lead vehicles, surrounding vehicle tracking, and lane boundary markers.
* **Robust Segmented Storage**: Stores recordings in rolling segments with CRC32 checksum framing, clean keyframe alignment, and atomic commit semantics to survive unexpected power cutoffs or engine shutdowns without corruption.

### 📱 Responsive Mobile Web Player & Desktop Viewer
* **Wireless Hotspot Transfer**: Connect directly to the car's Wi-Fi network to browse, view, and manage recordings in real time.
* **Multi-Camera Playback**: Synchronized multi-angle playback (Front, Rear, Left, Right) with individual camera selection and perspective mapping.
* **Cockpit Telemetry Bar**: Live visual telemetry HUD displaying active speed, pedal depression indicators, blinkers, and steering angle.
* **Interactive Route Map**: Synchronized OpenStreetMap tracking showing vehicle trajectory and location synchronized with video playback.
* **Composite MP4 Export**: Hardware-accelerated client-side exporter that merges all 4 camera angles, the route map, and the telemetry dashboard into a single shareable, high-definition MP4 file.
* **Complete Offline Capability**: Connect your USB drive directly to your Mac, PC, or iPad and access your library offline at [bimmerdrive.app](https://bimmerdrive.app) with no server connection required.

---

## Installation

### Step 1: Install the iDrive interface from MGU Store

**The Store entry currently installs the iDrive interface only. It does not install or provision the recorder companion. A different car needs the separate setup below before recording and phone playback will work.**

1. Open **MGU Store** on your BMW iDrive screen.
2. Navigate to **Settings → Add source**.
3. Add the GitHub repository source:
   ```text
   Hexphase/BimmerVision
   ```
   *(Or enter the direct catalog URL: `https://raw.githubusercontent.com/Hexphase/BimmerVision/main/catalog.json`)*
4. Locate **BimmerVision** under the applications list and select **Install**.

### Step 2: Provision the recorder companion (required separately)

The background recorder runs as a `systemd` service. Before installation, it requires vehicle-specific verified camera enrollment, the installed app’s current UID in `hardware.json`, and TLS certificates for phone transfer. Its `bimmervision-service` name must be present in both recovery allowlist sections of `/etc/recmgr-restartlist.conf`, followed by a parked infotainment restart before starting the service. The current Store entry does not perform these steps.

After those prerequisites are complete:

1. Download `BimmerVisionService-0.2.3.tgz` from the latest [GitHub Release](https://github.com/Hexphase/BimmerVision/releases).
2. Transfer the archive to your head unit via SCP:
   ```bash
   scp BimmerVisionService-0.2.3.tgz root@HEAD_UNIT_IP:/tmp/
   ```
3. Connect via SSH and run the installer:
   ```bash
   ssh root@HEAD_UNIT_IP
   cd /tmp && tar -xzf BimmerVisionService-0.2.3.tgz
   cd BimmerVisionService
   sh scripts/install-car.sh --enrollment /path/to/hardware.json --tls-dir /path/to/tls
   ```

---

## Disclaimer & Non-Affiliation Notice

> ### ⚠️ PLEASE READ CAREFULLY BEFORE USE
>
> **BimmerVision is an independent, non-commercial open-source project created solely by a passionate hobbyist who loves his BMW and automotive software engineering.**
>
> 1. **Not Affiliated with BMW**: This project is **NOT** authorized, endorsed, sponsored, affiliated, or in any way associated with Bayerische Motoren Werke AG (BMW AG), BMW of North America, LLC, or any of their subsidiaries or affiliates. "BMW", "iDrive", "MGU", and all related model names, badges, marks, and emblems are registered trademarks of Bayerische Motoren Werke AG.
> 2. **No Warranty & Use at Your Own Risk**: This software modifies or runs on automotive computer equipment (MGU head unit) and interacts with internal vehicle networks. The software is provided **"AS IS"**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, or non-infringement.
> 3. **Limitation of Liability**: Under no circumstances shall the author, developers, or contributors be liable for any direct, indirect, incidental, special, exemplary, or consequential damages (including, but not limited to, damage to vehicle electronics, head-unit bricking, warranty invalidation, loss of vehicle data, battery drain, vehicular accidents, personal injury, property damage, or traffic violations) arising in any way out of the installation, operation, or misuse of this software.
> 4. **Safety Warning**: **NEVER** interact with the BimmerVision interface, mobile pairing screens, or video playback while driving. Always prioritize road safety, maintain full attention on driving, and comply with all applicable road traffic laws and safety regulations.

---

## License

This project is licensed under the [MIT License](LICENSE).
