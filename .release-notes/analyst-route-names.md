type: patch
---
An analyzes route now matches a worker that has a named profile by that profile name only. A worker's label is free text that defaults to `worker`, so a route over a node named `worker` also matched every other worker that had no label. Before 0.298.0, an agent analyst ran only over workers that had a tool trace, which hid this. Once that requirement was removed, a graph `analyzes` edge over `worker` also launched a paid analyst over its fixer.
