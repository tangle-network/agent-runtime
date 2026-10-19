type: minor
---
A capture port may return `stages` beside its snapshot: its own split of the capture time, in its names and units (for example `exportMs`, `archiveStoreMs`, `offloadMs`, `exportBytes`). Runtime copies it verbatim onto the `workspace-capture` journal event, keeping up to 16 finite, non-negative numbers.
