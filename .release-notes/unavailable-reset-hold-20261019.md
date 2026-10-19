type: minor
---
A driver refusal that names its quota reset (the Z.ai Coding Plan's opencode `Usage limit reached for 5 hour. Your limit will reset at …`, read as +08:00) holds the node until that reset, never past the run's deadline, instead of probing every 15 s to 300 s, and records `resumeAt` on the paused attempt. magnetar-rust-20261018b spent 219 of 324 driver attempts probing that window (#1849). Consumers reading `DriverAttemptRecord` see a new optional `resumeAt` on an `unavailable` attempt.
