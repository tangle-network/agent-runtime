type: patch
---
A root driver's second attempt is no longer refused "scope owner materialization changed mid-run: resources" when only the applied resources it observed moved; like the execution instance, they are a per-attempt observation, and the attempt binds to the run's committed receipt.
