type: patch
---
A private CAS put or `offload()` that finds its object already being copied to the durable store waits for that copy instead of reporting it pending, so two captures sharing one store no longer refuse each other with "durable offload is pending after capture" (a regression in 0.325.6).
