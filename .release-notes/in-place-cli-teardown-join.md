type: patch
---
In-place CLI teardown joins its harness and profile-input cleanup before acknowledging destruction, reporting a settled failure as permanently unconfirmed without repeated cleanup retries.
