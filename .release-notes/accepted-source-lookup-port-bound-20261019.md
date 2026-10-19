type: patch
---
A resumed retained root recovers its accepted workspace with a source lookup bounded by the retention port's `timeoutMs`, not a fixed 30 s, and a lookup that times out says so with its bound. A box idle about 21 minutes took over 30 s to answer; the capture stayed pending and the resumed supervisor exited (test-acceptance-canary-20261018h).
