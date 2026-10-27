type: minor
---

`@tangle-network/agent-runtime/durable` exports `durableRunToolSpans(runDir)`: every tool span a finished `supervise({ runDir })` run recorded, read from the directory alone. The root's `root-stream.jsonl` becomes one trace named by the root node id, and each settled node's persisted trace is read from `<runDir>/blobs` and re-keyed to its node id. A node whose trace blob is missing throws `ValidationError`. The continuation panel's trace store reads through the same builder.
