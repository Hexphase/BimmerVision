# BimmerVision hardware preview decoder

Independently authored Hexphase MIT C code. This helper consumes standard H264
Annex-B from a parent-owned named FIFO and writes BimmerVision `BVCF` frames to
stdout. It uses the head unit's Intel Media SDK hardware decoder and VA DRM
libraries. It does not request cameras, connect to a cluster renderer, touch the
recording pipeline, rewrite SEI, or include any third-party camera/renderer client.

**Status:** host checks and Linux cross-compilation pass. Actual Intel decoder,
head-unit driver compatibility, camera appearance and sustained performance still
require a physical-car check. A successful cross-build does not prove playback.

## Build and test

On macOS with Clang and Python 3:

```sh
./native/bvcamera-decode/build.sh --test
```

This runs real frame/crop/scale/bounds checks with ASan/UBSan, real pipe tests for
partial bitstream retention, EOF, partial output and stalled consumers, and real
executable argument/FIFO tests. No GPU behavior is simulated or claimed verified.

Cross-build with an official Zig 0.14.1 executable, without installing it globally:

```sh
ZIG=/absolute/path/to/zig ./native/bvcamera-decode/build.sh --linux
```

The candidate is `native/bvcamera-decode/build/bvcamera-decode`. Build output is
ignored by Git. The script rejects a wrong architecture or a maximum GLIBC symbol
version newer than 2.17. It does not copy the candidate into a release package or
touch an installed car application.

For the macOS ARM64 toolchain used during development, the official archive was
`https://ziglang.org/download/0.14.1/zig-aarch64-macos-0.14.1.tar.xz`; its SHA256,
published in the [official download index](https://ziglang.org/download/index.json),
is `39f3dc5e79c22088ce878edc821dedb4ca5a1cd9f5ef915e9b3cc3053e8faefa`.
Verify the appropriate official archive's SHA256 before using any other platform.
Only the Zig executable is a build dependency; Zig is not shipped in the helper.
A Linux native C compiler can also compile `main.c frame.c` with
`-std=gnu11 -O2 -Ivendor/intel-mediasdk -ldl`.

## Runtime contract

```sh
bvcamera-decode --input /parent/owned/preview.fifo --width 592 --height 220
```

Input must exist and be a named FIFO; symlinks and regular files are rejected.
The parent is responsible for opening the writer and supervising the process.
Only binary frames are written to stdout. Diagnostics and `--help` go to stderr.
Use a dedicated pipe for stdout; the helper sets it nonblocking.

The full decoder-reported crop is resized to the requested even output dimensions.
No source size or half-frame camera selection is hardcoded. For the nominal
side-by-side camera stream, the default full output is 592×220, so each half is
296×220. The parent selects a half after decoding. Source crop and camera order
must be confirmed on the car. The helper preserves decoded YUV values, including
the stream's existing color range; it does not convert YUV to RGB.

Each frame has this exact 32-byte little-endian header followed by tightly packed
I420 Y, U, V planes. This is BimmerVision's internal pipe format, **not a renderer
protocol**. The first frame has sequence zero.

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | 4 bytes | ASCII `BVCF` |
| 4 | u16 | Version 1 |
| 6 | u16 | Format 1 (I420) |
| 8 | u64 | Frame sequence |
| 16 | u16 | Width |
| 18 | u16 | Height |
| 20 | u16 | Y stride = width |
| 22 | u16 | U/V stride = width / 2 |
| 24 | u32 | Payload bytes = width × height × 3 / 2 |
| 28 | u32 | Reserved zero |

## Hardware path and resource bounds

The executable dynamically loads only the hardware implementation
`libmfxhw64.so.1` or `libmfxhw64.so`, VA (`libva.so.1` or `.2`) and VA DRM
(`libva-drm.so.1` or `.2`). It opens `/dev/dri/renderD128`, falling back to
`/dev/dri/card0`, initializes its VA display, requests hardware via VAAPI with
Media SDK API 1.8, checks the selected implementation, and attaches the VA display.
No software decoder is attempted; partial acceleration and unsupported warning
statuses fail closed. A normal new-sequence `MFX_WRN_VIDEO_PARAM_CHANGED` queries
GetVideoParam and continues only with validated NV12 parameters and unchanged
coded surface dimensions. A runtime that lacks these symbols or system-memory NV12 decoding fails
this preview process.

DecodeHeader → QueryIOSurf → Init → DecodeFrameAsync → SyncOperation supplies a
bounded pool of system-memory NV12 surfaces. The code validates decoder dimensions
and crop, then performs its own nearest-neighbor NV12-to-planar-I420 resize.
Compressed bytes are passed unchanged, including original SEI and partial NAL
units, with retained unconsumed bytes between reads. EOF drains cached frames.
A change requiring incompatible decoded format/resolution, reallocation or unsupported
interlacing stops preview; crop/timing updates within the allocated layout are allowed.

Limits: 4 MiB compressed buffer; at most 32 surfaces and 128 MiB total surface
storage; coded width ≤4096 and height ≤2160; even crop/output dimensions; one async
submission at a time; 10 s FIFO idle/initial-writer wait; 1.5 s total write deadline
per frame; 1 s per hardware sync; 5 s decode progress deadline. A 15 s hard process
alarm covers a stuck driver call, with a 3 s hard teardown deadline. SIGINT/SIGTERM
request teardown, SIGPIPE cannot terminate the parent, and any hard alarm exits
124. The supervising parent should terminate/reap the child on shutdown and treat
EOF, nonzero exit, invalid frames or a stalled preview as preview-only failures.

## Required physical-car validation

1. Confirm the deployed VA/MFX library names/exports, `/dev/dri` permissions, API
   1.8 hardware selection and successful system-memory NV12 QueryIOSurf/Init.
2. Feed an unchanged known camera Annex-B stream to this candidate through an
   isolated FIFO. Capture stderr and parse the stdout `BVCF` stream independently.
3. Verify reported coded size/crop and full paired image against the original
   camera feed; verify front/rear and left/right half ordering and color range.
4. Exercise fragmented FIFO writes, stream EOF, child SIGTERM, blocked/closed frame
   consumer, decoder loss and malformed input. Confirm bounded shutdown and that
   recording continues unaffected.
5. Measure CPU, frame cadence, memory and renderer latency for a sustained drive.
   Confirm that closing/reopening preview does not leak decoder sessions or DRM
   descriptors. Release packaging and installation require those separate checks.

## API provenance and licenses

Only unmodified public ABI headers were vendored from the official Intel Media SDK
repository at commit `d0577708a6b3f209982841077334d395f9089890`
(tag `intel-mediasdk-22.5.4`). Their Intel copyright and MIT grants remain in every
header. `vendor/intel-mediasdk/SHA256SUMS` records the exact downloaded headers.
No Intel sample implementation was copied. Own code is covered by [LICENSE](LICENSE).

References used for ABI and documented decode semantics:

- [Official Intel Media SDK API headers](https://github.com/Intel-Media-SDK/MediaSDK/tree/d0577708a6b3f209982841077334d395f9089890/api/include)
- [Official Media SDK programming manual](https://github.com/Intel-Media-SDK/MediaSDK/blob/d0577708a6b3f209982841077334d395f9089890/doc/mediasdkusr-man.md)
- [Intel Media SDK developer reference](https://cdrdv2-public.intel.com/671472/mediasdk-man.pdf)
