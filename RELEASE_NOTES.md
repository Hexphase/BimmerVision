# BimmerVision 0.2.6

- Fixed export branding overlapping the date/time and enlarged exported turn arrows and steering wheel.
- Removed the HTTPS speed suggestion from export controls.
- Connect Phone has a single Back action; Settings/About explains computer USB viewing at BimmerVision.App and direct phone connection.
- Update checks fetch fresh GitHub Release information directly from the viewing device.
- Speed-limit lookup can use the viewing device’s Internet connection when the car cannot retrieve an explicit mapped limit; unknown limits remain blank.

# BimmerVision 0.2.5

- Removed the artificial 1 MiB/s recording-download cap when the recorder explicitly reports no write in progress.
- Idle downloads use larger bounded reads; capture status and USB validity are still checked between reads.
- Starting recording during a download restores the recording-priority rate cap, and queued capture data always takes priority.
- Complete-recording buffering before playback remains enabled.

# BimmerVision 0.2.4

- One Store Install action now installs the iDrive interface and its required recorder companion.
- The companion is managed by the Store, including its service, recovery registration, enablement and updates.
- Each car creates its own private phone certificates and discovers its actual installed app identity. No copied hardware enrollment, keys or SSH setup is needed.
- Fresh camera setup validates the actual multiplexed RTP/H.264 stream. Missing or unsupported streams remain pending and retry.
- The app explains a required first-install iDrive restart; the software does not reboot a car automatically.
- Existing verified standalone BimmerVision recorder setups can migrate locally; recordings on USB are preserved.

- Playback downloads each complete recording before enabling Play, cancels obsolete timeline loads, and handles damaged camera packets and end-of-clip decoding.
- Export completion waits now have cancellation and bounded failure handling instead of waiting indefinitely.
- Recorded GPS is indexed for drive maps; speed limits use explicit mapped limits when available.
- Web Settings includes a single BimmerVision.App website button.

Supported release target: iDrive 7 MGU Linux x86-64 with supported camera hardware. The Store’s installed-app icon follows the iDrive menu icon, as required by this Store version.

See `CAR-SHA256SUMS` for the two release artifacts.
