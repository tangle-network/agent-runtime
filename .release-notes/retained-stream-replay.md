type: patch
---
Resume stalled retained event reads from the last observed cursor within the same driver attempt. Advancing cursors permit further replay; an unchanged cursor stays bounded. Preserve the original execution and exact-result authority without redispatching work.
