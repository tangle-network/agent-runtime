type: patch
---
A profile file the box refuses to replace is no longer retried as a lost transport. Sandbox's typed `PROFILE_FILE_CONFLICT` (HTTP 409), and the untyped `Refusing to replace existing profile file` refusal it sends before that type ships, now read as a provisioning refusal: the request was refused before it ran, the driver stops at that attempt, and the parent's wake names the file. On Discovery run magnetar-rust-sandbox-20261031g, managers s0 and s1 retried this refusal on every turn after their first.
