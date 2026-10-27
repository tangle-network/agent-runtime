type: minor
---
`startRetainedRun` and `startRetainedInteractiveRun` accept `journalRoot`; each run appends its admissions to `<journalRoot>/<runId>/observer.jsonl`, and `agent-runtime-top --web --root <journalRoot>` shows every such run as a card.
