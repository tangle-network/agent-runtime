type: patch
---
A worker's journal `progress` rows now publish on a leading-edge one-second window, and `awaiting-result` rows always publish (#2340). Each row is a fsynced journal append, so a row per stream frame held a GLM critic's stream to about 10 frames per second on a slow disk; its finished turn fell 1,024 frames behind its exact result and settled down (#2339). `scope.progress(id)` still sees every event's running total.
