# Architecture rules

- Derive every Miami agent URL (HTTPS sslip.io name first, then the configured URL, then port 80) from the configured agent host, including IP-embedded nip.io/sslip.io names, because the app host may fail to reach a given port and derivation keeps SSRF scope fixed.
- Cap each Miami agent call with a total deadline below the UI timeout, so the screen never spins forever.
- Route every Miami send trigger through one per-job lock reserved before any await, honor flood deadlines, and treat RANDOM_ID_DUPLICATE as "reconcile" until an id is associated; concurrent identical requests create duplicate-send races and misleading timings.
- Share Telegram device identification across authentication and restored connections; omit runtime version metadata because it is not part of the public device label.
- Keep wizard exit navigation shared and preload its destination without bypassing authentication; skip field resets and draft writes during exit to avoid redundant rendering.
- Share the access notification surface across login and registration; keep every registration confirmation/progress/failure state in one dialog shell, separate from persisted steps, and never let timed statuses replace real Telegram success checks.- Create missing my.telegram.org apps from the site first, then retry through the Miami agent's fixed IP, because Telegram rejects app creation from changing host IPs with a bare ERROR.

- Fire "abertura" only on target-group signals that prove writing is open (parsed rights or a non-admin member message), with one Telegram connection per account and read-only reconciliation instead of send-probing, because send-probing caused FLOOD_WAIT and parallel copies of one authorization risk AUTH_KEY_DUPLICATED.
- Pointer effects (spotlight, tilt, magnetic) run from one delegated listener in src/lib/effects.ts and set html[data-lite] on weak devices, so heavy motion stays opt-out and cheap.
- Confirm a send as soon as the account's own message appears in the group (out, same peer, matching text, id above baseline, within 10s), because Telegram bundles the sender's own update with the RPC ACK and megagroup ACKs take ~0.6s server-side; never re-enable send-probing or a second connection to chase that number.
