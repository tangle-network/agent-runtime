type: patch
---

Omit unavailable node labels, settled output, and token usage from runEvidence instead of returning undefined-valued properties. Failed and interrupted run summaries now remain canonical JSON inputs for immutable dataset admission without inventing output or zero usage.
