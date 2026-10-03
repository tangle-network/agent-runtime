type: patch
---
Spawned and recovered children no longer each hold their own copies of the strings in their profile. Runtime snapshots share the source strings instead of cloning them, and one recovery pass shares equal strings across the children it parses from blobs. A coordinator whose children mount the same 5.3 MB file packet grew by about 22 MB per spawn and 27 MB per recovered child (43 and 54 MB with two-byte text). It now grows by about 0.2 MB per spawn and 0.5 MB per recovered child.
