type: patch
---
Verify the requested graph digest and its actual canonical content on registry read. Missing files remain unavailable; corruption and read errors refuse instead of returning an unrelated compiled graph or silently starting fresh work. Reuse this same identity check when retaining an existing immutable revision, including observed graphs.
