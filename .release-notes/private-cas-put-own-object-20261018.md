type: patch
---
A private CAS put uploads its own object instead of sweeping the whole store, so capturing into a host that keeps its objects is linear rather than quadratic; an explicit `offload()` still runs the full pass.
