type: major
---
Runtime 2.0 records export-shape changes since 1.0: `StartRetainedRunOptions`, `StartRetainedInteractiveRunOptions` and `RetainedRunStartMaterial` gain optional fields (including `journalRoot`), `RunLocalHarnessOptions` changes for stdin prompt delivery, and `loadTopSnapshot` gains the workflow/journal `runDir` overloads. Callers need no change. Code that implements, re-declares or exhaustively maps these types must add the new members.
