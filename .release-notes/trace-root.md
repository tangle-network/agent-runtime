type: minor
---
Require Eval 0.214, which adds the ledger-core Merkle exports Runtime uses for trace roots. The Eval peer range moves to `>=0.214.0 <0.215.0`.

Commit every archived turn to a trace root. The journal record that cites an output with an event array (`execution-result`, `execution-evidence`, and the `settled`, `cancelled` or `reconciled` record of a non-retained child) now carries `traceRoot: { root, ref, leafCount }`. The `TraceRootArtifact` stored under `ref` holds one salted leaf per archived event and a final summary leaf with the event count and the tool calls by name, so one event or one count can be proven with a Merkle inclusion proof against `root`. Records written before this release carry no `traceRoot` and still replay. `TRACE_ROOT_SCHEMA`, `TRACE_SUMMARY_SCHEMA`, `TraceRootArtifact`, `TraceSummary` and `TraceRootReceipt` are exported from `/kernel`.

`mapSandboxToolEvent` now projects codex tool items (`raw` events carrying `item.started` or `item.completed` for a command, MCP, collaboration, web search or file change item) as one `tool_call` per item id and one `tool_result` when the item completes. Codex turns previously projected no tool calls, so `SandboxLeafOut.toolCalls` and streamed tool events now include them.
