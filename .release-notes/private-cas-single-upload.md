type: patch
---
A private CAS offload pass no longer copies an object that its own buffered `put` is still uploading, so concurrent puts upload each object once and a buffered store never reads a second copy of the same archive into memory.
