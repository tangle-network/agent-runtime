type: minor
---
A driver whose attempts fail instantly (under 30 s) with the same error, 10 or more in a row over at least 5 minutes, stops with the new `DriverAttemptStop` `repeated-failure`, even while the rest of the run spends or settles. Before, the run-wide progress mark read each such failure as progress, and the barren bound never fired: magnetar-rust-20261017c retried `connect ECONNREFUSED 127.0.0.1:32897` 1,258 times.
