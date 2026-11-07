type: patch
---
- `agent-runtime-mcp` serves a run directory's committed root stream through the `events_*` tools when `MCP_ENABLE_EVENTS=1` and `AGENT_RUNTIME_EVENTS_ROOT_STREAM=<runDir>`: the sequence is the line's own `seq`, which continues across drive attempts and processes, each record carries its `attempt`, a torn tail is never served, and the digest chain lets an observer detect rewritten history at its cursor. Removes the internal `submitAgentImprovementProposal` body left behind when its export was removed.
