type: patch
---
Retained provider observation checks a replayed frame against its first copy with a native SHA-256 of the frame's JSON instead of an RFC 8785 digest per frame, so a coordinator reading hundreds of MB of frames a minute keeps its event loop.
