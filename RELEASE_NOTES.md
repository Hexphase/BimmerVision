# BimmerVision 0.2.38

Fixes access to Export and Settings in the recordings player.

- Mobile playback now keeps Export visible beside the gear button.
- The gear menu opens above playback instead of being clipped below the header. Settings and the menu’s recording actions are accessible in the drive library and playback.
- The menu scrolls within short screens. Existing playback, timeline, camera selection and export behavior are preserved.
- Updated the stylesheet cache key so browsers receive the fix after refreshing.

Install app and recorder **0.2.38 together** through MGU Store. BimmerVision Web uses the same fix and matching version number. Recording behavior, native iDrive controls and recording preferences are unchanged.

Validation: both automated suites pass; browser checks exercise visible Export, the export dialog, Settings hit targets and dialog, Escape dismissal, scrolling and layouts at 320, 390, 768, 1024 and 1440 pixels through local USB and the production car Transfer server. Physical-car installation of this update has not been performed.
