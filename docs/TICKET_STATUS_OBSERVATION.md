# Voucher badges: RouterOS evidence and cloud delivery

RouterOS presence is not inferred from `tickets.sync_status`. That legacy field
continues serving existing workflows and cloud API compatibility.

Migration 031 adds local-only `router_observation_status` and
`router_observation_at`. A synchronization/action report saves these fields in
bounded transactions, scoped to account, router and ticket. Cloud upserts do not
write them. No backfill guesses that a historical ticket still exists remotely.
A newer shared RouterOS timestamp invalidates an older local observation.

- Unknown/legacy: **A verifier sur le routeur**. Run the read-only **Synchroniser** action.
- Successful RouterOS observation: present, missing, conflict or confirmed removed.
- Failed check: retain previous evidence and show a page warning; do not infer absence.
- Residual active session without Hotspot user: error, never successful cleanup.
- Cloud pending/failure: obtained separately from scoped catalogue outbox metadata,
  refreshed every 15 seconds. No queue entry does NOT prove cloud acknowledgement.

Labels describe the last observation, not guaranteed real-time network state.
Observation date is available in ticket details and on the row's presence badge.
Expiry, usage and archive business states remain separate from network evidence.

Restart the desktop native process after upgrading so migration 031 runs before
testing. Reopen Tickets and click Synchroniser; reopen again to verify persistence.
No VPS migration/deployment is required for these local columns. Another PC must
perform its own RouterOS check rather than inherit this PC's local evidence.
No voucher creation, repair or deletion is triggered by badge classification.
