type: patch
---
A box check whose command the box cannot start (Sandbox's `Command setup failed (identity, cwd or exec)` spawn refusal, which replaced the exit-127 `process-supervisor: exec failed` stderr) settles `refused` with that message as its diagnostic and stderr, and its box is deleted rather than kept as an unsettled recovery source.
