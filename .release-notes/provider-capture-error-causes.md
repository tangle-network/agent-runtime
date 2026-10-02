type: patch
---
Preserve the original provider stream failure alongside a workspace-capture publication error that already has its own cause, without mutating a shared persistence error or introducing a self-referencing cause. Retention checks now require recoverable controller interruption on journal/blob failure and verify the preserved source and absence of terminal records.
