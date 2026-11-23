# Persistent recording preference — 0.2.18

The original menu treated an absent `continuous` value as enabled while the recorder treated a missing RAM control file as paused. Both used `/tmp/bimmervision-<uid>/recorder-control.json`, which does not persist across a head-unit reboot.

The fix saves only the explicit boolean in `/var/opt/bimmervision-recorder/preferences/<discovered uid>/recording-preference.json`. The root service prepares a traversable root-owned parent and a private app-owned directory. The app saves and fsyncs Enable/Pause before updating RAM. Both readers use that durable value; an absent preference defaults to paused, and the first Enable action writes true. Existing explicit RAM preferences migrate once using an atomic create that cannot replace a newer user choice. Phone visits, erase commands, status and heartbeat stay in RAM.

A menu-only correction would leave recording disabled after reboot. Persisting the entire control file could replay phone visits or erase commands. Persisting just the boolean addresses the user's enable-once requirement.

Validation: five regression tests exercise loss of RAM for both Enable and Pause, real menu first press, migration and stale RAM, unsafe/malformed settings, and directory permissions. Full release suite: 109 passed. Independent code review found no actionable issues. Car installation and live verification are recorded privately under `/Volumes/BMW/persistent-recording-2026-11-14/`.

The car was unexpectedly running app/tool 0.2.8 at preflight, not the earlier local 0.2.17. Deployment backups show intervening uninstall/install activity; the initiating cause was not established. The current car state was backed up before installation. This patch does not change Store settings or publish a public release. Full physical head-unit sleep/wake remains a separate test from a recorder-service restart with missing RAM controls.
