type: patch
---
Expose runTaskQueue for caller-owned bounded admission and settlement, and reuse it for Runtime batch execution and concurrent lineage operations. Completed failures stop further batch admission, and failed or interrupted consumers await already-started work without changing the original rejection.
