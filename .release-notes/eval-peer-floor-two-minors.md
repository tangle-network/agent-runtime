type: patch
---
Fixed the `@tangle-network/agent-eval` peer floor #1419/#1421 left at `0.191.0`. The dependency contract requires the floor to sit within two minors of the pinned development version (0.197.0), and 0.278.0's release CI caught the violation before publish (`verify` failed: "peer >=0.191.0 <0.198.0 reaches back more than two minors from 0.197.0"). Nothing shipped: npm still serves 0.277.0. The floor is now `0.195.0`, so the range is `>=0.195.0 <0.198.0`.
