type: patch
---
Continue a supervised retained owner whose last committed turn failed. After a restart its first drive still surfaces that failure once; the next drive, in the same process or after a later restart, dispatches a new turn instead of replaying the same committed result again. A committed successful turn is still restored, never run again, and its spend is counted once.
