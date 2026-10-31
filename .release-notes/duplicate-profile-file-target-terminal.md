type: patch
---
A profile that mounts one file twice is no longer retried as a lost transport. Sandbox's untyped `Duplicate profile file target` refusal now reads as a provisioning refusal: the request was refused before it ran, the driver stops at that attempt, and the parent's wake names the file. On Discovery run magnetar-rust-sandbox-20261031h, managers s0, s1 and s2 mounted `inputs/commission.md` and `/home/agent/inputs/commission.md`, one target since Sandbox SDK 1.0.157, and retried this refusal on every turn after their first.
