type: patch
---
The tool loop's stuck-loop guard counts repeats across model turns only. Identical calls inside one model turn's parallel batch no longer stop the loop: each runs and the model reads every result, a tool error included, on its next turn. A model turn whose calls are the same set as the previous turn's counts once, and three such turns in a row still stop with `stuck-loop`. Both `runToolLoop` and `streamToolLoop` share the rule.
