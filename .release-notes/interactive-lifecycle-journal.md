type: minor
---

`startRetainedInteractiveRun({ journalRoot })` now journals the run's lifecycle beside its admissions in `<journalRoot>/<runId>/observer.jsonl`. Each accepted `sendPrompt` becomes an `agent.turn` record carrying its number and operation id, never the prompt. The first `exited` status read, or an accepted `stop`, writes one terminal `agent.run` record: done for a clean exit or a stop, failed for a lost session or a nonzero exit code. `agent-runtime-top --web` then shows the run settle instead of running forever.
