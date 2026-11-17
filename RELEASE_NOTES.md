# BimmerVision 0.2.39

Updates the playback Export button with the approved styling shared by BimmerVision Web and the car-hosted player.

- Mobile: compact blue export icon beside the gear button. The 32-pixel visual keeps a 44-pixel tap area and an accessible “Export video” label.
- Desktop: blue Export button with the same icon, bold white label and visible keyboard focus.
- Keeps the date, back navigation and Settings menu accessible, including on narrow and short screens.
- Updated asset cache keys so the new styling appears after refreshing.

Install app and recorder **0.2.39 together** through MGU Store. Recording behavior, native iDrive controls and recording preferences are unchanged.

Validation: both automated suites pass. Browser checks cover local USB and the production car Transfer server, mobile/desktop button appearance, tapping outside the mobile icon within its touch target, the export dialog, Settings, Escape, scrolling and viewport sizes from 320 to 1440 pixels. This release has not been installed on the physical test vehicle.
