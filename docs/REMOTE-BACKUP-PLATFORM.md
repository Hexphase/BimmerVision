# Remote Backup architecture

BimmerVision saves recordings on USB and optionally backs them up directly to the user's Google Drive. BimmerVision has no recording relay, hosted recording database or developer access to recordings or recording metadata.

## Car uploads

Google sign-in, DNS resolution, metadata requests and upload traffic are gated on eligible Wi-Fi. A dedicated backup identity and device-bound network helper enforce Wi-Fi-only transport; the native app has no general Internet grant. Losing Wi-Fi, USB access or upload eligibility cancels work safely. Never grant a fallback route through vehicle cellular.

Upload state is persisted atomically on the recording USB drive. The worker uploads one drive at a time, reconciles resumable sessions and verifies completed files. Verified originals are retained subject to the ordinary USB retention policy. Full Google Drive storage pauses the queue visibly. Drive selection and clip locking are separate operations.

Backups are allowed at any speed by default. The optional driving restriction requires a fresh, validated stationary signal. Pausing recording during backup independently requires stationary eligibility; motion resumes recording. Unknown signals fail closed for restrictions that require them.

## Phone uploads

While a paired phone viewer is active, all car-side cloud requests pause. The phone reads selected original files from the authenticated car server and sends them to Google through the phone's own Internet connection. Explicit consent is required before phone cellular use. The car resumes eligible Wi-Fi backup after the viewer disconnects.

The secure upload window uses a scoped, expiring bridge to the existing car tab. Exact origins, window identity, nonce, request IDs, bounded transfers and an endpoint allowlist are checked. Car authentication remains in the original tab; Google authorization remains in the secure window. Neither token crosses into a BimmerVision server. Closing a window, changing the source or losing the lease stops the phone job. A takeover may restart an unfinished file, while verified completed files remain complete.

## Horn protection

A horn event protects complete clips intersecting the 30 seconds before and after it, including adjacent clips and decoder prerequisites where necessary. Protection is persisted and reconciled as clips finish. The locked-only backup policy includes horn-protected clips even when the rest of their drive is unlocked. Google Drive setup and automatic uploads must be enabled for automatic backup.

## Credentials and release hygiene

Account tokens, private client configuration, TLS private keys, vehicle identities, network addresses, capture data and operational logs must remain outside public source and generic packages. A distributable Google limited-input-device client identity is distinct from user credentials; production release preparation is documented separately. Browser OAuth client IDs are public identifiers. Request only the `drive.file` scope, allowing BimmerVision-created or explicitly authorized files rather than unrestricted Drive access.

The generic native drive list labels times as UTC unless an explicit display timezone is configured. Vehicle-specific configuration must never be copied into public defaults.

## Validation

Automated coverage includes upload persistence, resumable-session reconciliation, Wi-Fi binding, permission changes, horn windows, native widget contracts, phone leases, bridge validation and player navigation. Physical device behavior, radio throughput and vehicle sleep timing vary; test representative vehicles and avoid treating local checks as proof of every vehicle condition.
