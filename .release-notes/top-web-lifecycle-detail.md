type: patch
---

`agent-runtime-top --web`: closing the viewer now ends the snapshot stream with `event: end`, so a client can stop instead of reconnecting to a closed server. For a run under a runs root (`<root>/<runId>/observer.jsonl`), an agent's transcript now reads that run's own blobs and projection, so it shows the input the agent was given. When an agent's native conversation was not captured, the transcript also shows the result it delivered (`provenance: 'recorded-result'`).
