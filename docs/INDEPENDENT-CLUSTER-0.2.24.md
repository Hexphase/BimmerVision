# BimmerVision 0.2.24 — testing preview pipeline

The candidate replaces two components from the earlier local0.2.23 preview: the TurnView native camera decoder and the copied Cluster renderer JavaScript client. The new decoder and client are original Hexphase MIT implementations from documented Intel APIs, the published renderer protocol and BimmerVision's own functional requirements. Existing recorder, camera-selection policy, preferences, fades and preview priority remain.

## Components

- `native/bvcamera-decode`: original C hardware-only IntelMediaSDK/VA decoder. It consumes unchanged selected AnnexB camera access units and emits BimmerVision's own bounded I420 pipe frames. No renderer client, camera control, FFmpeg implementation or TurnView source/binary is included in this helper.
- `recorder/files/cluster/renderer-link.js`: original Node8 image-only renderer client with bounded retention, complete-frame coalescing, framing validation, reconnect and explicit close.
- `decoded-frame.js`, `camera-pair.js`, `decoder-session.js`, `rgba-output.js`, `independent-worker.js`: original Node integration. Camera-pair selection keeps original H264 NAL bytes unchanged. Each camera generation uses a fresh image reference; separate persistent background layers retain Map ownership.
- Shared Cluster renderer remains a separately installed Store dependency. BimmerVision's client uses its socket interface. Its package retains its own notices; BimmerVision does not ship that service.
- Unmodified official IntelMediaSDK headers keep their copyright/MIT grants. The complete Intel license and BimmerVision decoder license are included in the runtime package. Source/binary provenance is recorded in `DECODER-PROVENANCE.json`.

## Source and package inventory

The test update uses the new BimmerVision decoder and client. Existing vehicle-signal and capture transports are unchanged. Their recorded provenance and the package's applicable license notices remain in the source and installed files.

## Verification

194 Node tests pass. Native host tests cover frame serialization/scaling/crop bounds under ASan/UBSan; partial input, EOF, partial/stalled output, surface/status limits, FIFO validation and CLI isolation. A real renderer socket regression first failed because the old image could become visible before replacement pixels; dropping only the camera overlay at generation changes fixed it while retaining Map background layers.

The Linux x86_64 helper cross-builds using verified official Zig0.14.1 with maximum GLIBC2.17. Two builds from the same inputs produced identical66,152-byte binaries, SHA256 `fd1f8fe3c09fb1ec3698d286fc1fb20592472819f3b237facbe23539a49bfcd5`.

Host mocks and a cross-build do not prove OEM decoding. API/VA compatibility, decoded crop, camera order/colors, sustained15FPS, rapid switching, recording isolation and phone playback need a parked-car test. The new pipeline has not been installed or road-tested on the project car. This prerelease is available specifically for parked hardware testing.

## Rollback and test distribution

The tested0.2.23 installation is unchanged. Its prepared release branch and Desktop bundle are retained as the rollback baseline. The original-components work is on `codex/independent-cluster-components`. The owner requested this prerelease for manual download and testing. The stable Store catalog remains unchanged. Keep the matching previous packages for rollback until the new pipeline has passed actual hardware checks.

## Build

Use `ZIG=<verified official0.14.1 executable> npm run build:native-preview` to rebuild the helper and source-hash provenance. Then run `npm run build` and `npm test`. Package building rejects stale native sources/binary hashes and retired copied decoder/client files. For Intel header and toolchain details, see `native/bvcamera-decode/README.md`.
