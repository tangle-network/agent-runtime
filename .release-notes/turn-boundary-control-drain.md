type: patch
---
The native turn-end control drain no longer applies worker controls first seen after a harness turn ended, and no longer awaits a worker delivery still in flight: a cancel observed only at that boundary expires `not_live` instead of retroactively terminating an already-finished worker, and the run closes without waiting on a blocked event callback. Root-inbox steers are still admitted before the wake-or-pause decision.
