type: patch
---
JSONL appends (spawn journal, observer, coordination log, corpus, stored-graph-check) now fsync after the run fence on the thread pool, not on the event loop inside it. An append still resolves only once its bytes are durable, while a live supervisor keeps reading its root stream during the commit wait (#2362, #2378). Pair it with agent-eval 1.0.19, whose lock owner records skip their own fsync.
