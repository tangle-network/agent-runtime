type: patch
---
A retained start no longer ends the run at its first failed Sandbox create. When a create does not answer within the materialization bound, or Sandbox answers `OPERATION_FAILED`, it is tried again with the same idempotency key: three creates in all, with a short pause between them. The last failure still stops the driver, named.
