# Pagination freezes: native I/O and background pressure

Code findings:
- The page already renders 25 rows, not the full catalogue.
- SQLite execute/query/transaction commands were synchronous Tauri commands.
- Each periodic RouterOS report updated every observed ticket using a read,
  write and reread per ticket, launched through unbounded Promise.all.
- Catalogue refresh could overlap a previous refresh; grouping also repeatedly
  copied each batch array.

Changes:
- Native database work runs through spawn_blocking, admitted one operation at a
  time by an async mutex. The owned permit stays inside the worker even if its
  caller disappears. Backup and restore use the same lane to avoid concurrent
  copies during a transaction. SQL and transaction semantics are unchanged.
- At most eight ticket updates/history tasks/batch tasks are submitted together;
  each chunk fully settles, then yields to browser input/paint. Errors still fail
  the operation; subsequent chunks are not launched after failure.
- Unchanged business/runtime values do not trigger complete ticket updates or
  new catalogue snapshots. Fresh RouterOS observations are still stored in
  transactions of up to 250 entries. Batch aggregates remain reconciled.
- Changed batches are published; failures before enqueue stay retryable for the
  page lifetime. Durable outbox retries remain active; initial publication on
  reopening still reconciles the saved catalogue.
- Concurrent pulls of the same router/purpose share one in-flight operation.

Validation: bounded-concurrency and injected-failure tests; 10,000 unchanged
vouchers cause no full ticket updates; pagination test renders 25 rows; native
test verifies off-caller-thread execution, exclusive access and error recovery.
These are mechanism tests, NOT a latency measurement on the customer's PC.

Manual acceptance requires restarting/recompiling the native Tauri process,
not merely reloading Vite. Test next/previous continuously across several
15-second refresh cycles, then change one voucher on RouterOS and verify its
state still updates. Test offline/reconnect and a cloud publish failure/retry.
Do not close the app while a voucher creation/deletion is in progress.
