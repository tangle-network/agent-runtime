type: patch
---
A resume refused because its host is full (`HOST_SLOT_UNAVAILABLE`) is a capacity wait for the supervisor, not a `terminal-error` stop, even when an older controller answered it as a 500.
