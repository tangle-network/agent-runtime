type: patch
---
A `spawn_worker` call without a `label` now labels the worker with its profile name, and only an unnamed profile falls back to `worker`. magnetar-rust-20261018b's 13 workers were all labelled `worker`, so no tree or run view showed a role.
