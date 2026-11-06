type: patch
---
- `spawn_worker` accepts an optional `resources` request (`cpu`, `memoryMb`, `diskMb`, `gpu`) that sizes a provider worker's create over `defaults.resources`; the provider backend's `maxWorkerResources` is the ceiling, and a request above it (or with no ceiling) is refused before any create, naming the ceiling (#1277).
- `fileEscalateQuestion(runDir, runId)` writes each `ask_parent` question to `questions/<id>.json` under the run, so an out-of-process observer can read it and answer with a root `writeWorkerSteer` (#1165).
