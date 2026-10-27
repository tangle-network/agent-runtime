type: minor
---
`@tangle-network/agent-runtime/durable` exports `runTraceAnalysisStore`, `ASSISTANT_TEXT_SPAN` and `ASSISTANT_REASONING_SPAN`, so a caller can build a durable run's trace store from its root stream, its workers' traces and its result blobs without copying Runtime code.
