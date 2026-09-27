type: patch
---
Widened the `@tangle-network/agent-eval` peer range to `>=0.191.0 <0.198.0` and bumped the `agent-knowledge` catalog pin to 17.1.8 (#1419). A fresh install against agent-eval 0.194.0 through 0.197.0 previously failed strict peer resolution; the census of this package's own imports from agent-eval found nothing outside that range's stable surface.
