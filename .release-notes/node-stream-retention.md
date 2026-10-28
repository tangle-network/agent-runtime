type: minor
---

A `supervise({ runDir })` run now keeps every worker's progress stream (text, reasoning, tool calls and results, redacted), not only the root's: `<runDir>/streams/<node>.jsonl`, in the `root-stream.jsonl` record shape. A worker that streams nothing writes no file. `agent-runtime-top --web` reads it as that agent's transcript, so a bridge or provider worker's conversation is shown in place of "Native conversation was not captured".
