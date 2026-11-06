type: patch
---
Read historical kindless spawn-journal envelopes and let read-only projections explicitly skip malformed physical rows with `readSpawnJournal(runDir, { invalid: 'skip' })`, preserving strict defaults and atomic groups.
