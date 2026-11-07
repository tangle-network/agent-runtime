type: patch
---
Flow graphs gain check nodes (`{ id, check: { command, timeoutMs?, environment?, egress?, secrets? } }`): Runtime runs the command instead of an agent and settles `{ pass, exitCode, output, json }`, with evidence at `$GRAPH_EVIDENCE/<nodeId>.json`, journaled receipts, and box placement through `RunGraphOptions.checkPlacement`. Graph files and stored graphs gain `workspace: cwd | fresh`, resolved by `graphWorkspace`.
