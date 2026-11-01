type: patch
---
A Sandbox create refused with 409 `NO_HOST_FITS_SHAPE` for a shape that fits (`its room is held placeable on <sku>`, no exceeded dimension) is now a capacity wait: the driver pauses and retries within the run's deadline, budget and cancellation, with `unavailableSignal: 'host-room-held'`, instead of settling down at its first attempt. A `NO_HOST_FITS_SHAPE` that names an exceeded dimension stays terminal. Source: Discovery run magnetar-rust-sandbox-20261101a, nodes :s1:s1, :s1:s3, :s5 and :s6:s1.
