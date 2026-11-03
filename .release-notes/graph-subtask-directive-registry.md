type: patch
---
A `maps` edge's `graph` item flow and a manager's `run_graph` subtask now resolve their edge directives against the `registry` passed to `runGraph`, the same registry the starting graph uses. Before, they resolved only against the seeded kernel registry, so an item flow whose directives were registered on the caller's registry refused its first spawn ("prompt registry: no entry for …"). `SuperviseOptions.promptRegistry` carries that registry; `runGraph` sets it.
