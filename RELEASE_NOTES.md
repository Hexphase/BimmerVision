# BimmerVision 0.2.37

The car-hosted player now uses the redesigned BimmerVision Web recordings and playback interface, opening directly to saved drives without the hosted homepage.

- Edge-to-edge dark playback with a pinned video and compact telemetry bar on mobile, a scrollable timeline, camera selector, driving view and map; desktop keeps these views together.
- Interactive camera selection, tap to play/pause, edge double-tap to skip ten seconds, and drive-aware previous/next recording navigation.
- Metadata-based 3D driving view with unbranded vehicles, traffic direction, distances in feet, blinkers, recorded lane information and recognized road signs. Estimated road geometry is illustrative rather than verified lane topology.
- Optional driving-view video export and bounded preloading of the next two recordings.
- Preserved car pairing, same-origin authentication, cached map tiles, recording notices and original-recording downloads. The public Web player retains its separate local-folder homepage.

Install app and recorder **0.2.37 together**. Recorder behavior and native iDrive controls are unchanged. Existing recordings and recording preferences are preserved. Browser playback processes recordings on the viewing device; map tiles may require network access.

Automated and local browser validation is included in this release. Physical-car validation of this webserver redesign has not been performed; this publication does not install or restart the car application.
