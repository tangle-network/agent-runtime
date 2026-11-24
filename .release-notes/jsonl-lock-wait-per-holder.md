type: patch
---
The JSONL file lock behind `recordGraphRun`, `recordProfileRun`, the stored-graph check, the corpus append and the interactive delegation journal now waits up to 5000 ms for each live holder, instead of 5000 ms in total. A write queued behind other writers on a host with slow disk syncs is no longer refused with `journal file lock unavailable after 5000ms`.
