type: major
---
Runtime 2.0 records export-shape changes since 1.0. `RetainedRunStartMaterial` gains optional `preserveEnvironment`; `StartRetainedRunOptions` and `StartRetainedInteractiveRunOptions` gain optional `journalRoot`; `RunLocalHarnessOptions` gains `stdinPromptArgIndex` and `invocation.prompt`; `loadTopSnapshot`'s `runDir` options gain `format: 'workflow' | 'journal'`. Callers need no change. Code that implements, re-declares or exhaustively maps these types must add the new members.
