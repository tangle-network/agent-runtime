type: patch
---
A supervised run's claimed run-directory writes (result blobs, journal appends, stream files, lock acquisition and release) run on one durable-writer thread instead of the caller's event loop, with the same fence, ordering and fsync before acknowledgement; on a saturated disk the coordinator's event loop no longer blocks on its own writes. A writer that dies or does not answer fails every waiting write; nothing falls back to writing on the caller's thread.
