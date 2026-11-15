# Cluster preview components — 0.2.24 candidate

The BimmerVision hardware preview decoder and renderer socket client are original Hexphase implementations, licensed under MIT.

## Intel Media SDK API headers

Only unmodified official Intel ABI headers are used to build the decoder. Their Intel copyright and MIT grants remain in native/bvcamera-decode/vendor/intel-mediasdk, and the complete official license is included here as LICENSE.intel-mediasdk. The native helper's own MIT license is LICENSE.bvcamera-decode. Source, compiler and binary hashes are recorded in DECODER-PROVENANCE.json. No Intel sample implementation or FFmpeg decoder is bundled.

Official header source: https://github.com/Intel-Media-SDK/MediaSDK/tree/d0577708a6b3f209982841077334d395f9089890/api/include

## Separately installed Cluster renderer

Cluster renderer remains an external MGU Store dependency, installed from robertnisipeanu/idrive-apps. It retains its own package's copyright and GPL-3.0-or-later notices. BimmerVision does not bundle or modify that service.

Our original image-only client implements the published socket interface; no upstream renderer client source is included. Protocol reference: https://github.com/robertnisipeanu/idrive-apps/blob/main/native/cluster-render/PROTOCOL.md

The preview also calls the BMW head unit's existing Intel Media SDK, VA and DRM libraries. Those system libraries are not shipped here. Actual hardware compatibility and performance remain pending parked-car validation.
