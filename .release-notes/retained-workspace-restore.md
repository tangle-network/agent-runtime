type: minor
---
Retained directors checkpoint their workspace during coordination and restore the latest checkpoint when their provider replaces a lost environment.
Restore receipts verify the checkpoint marker, and re-entry instructions tell directors to read restored files before repeating work.
This requires agent-interface 2.13.0 and a provider with workspace checkpoint restore support.
