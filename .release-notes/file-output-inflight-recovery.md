type: patch
---
A restarted coordinator reconnects an in-flight file-mode owner turn to its original native run instead of refusing it before any result; file custody still holds the source until that turn's own durable result.
