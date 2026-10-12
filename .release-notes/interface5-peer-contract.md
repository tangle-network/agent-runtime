type: minor
---
Align the unreleased Runtime transfer implementation with Interface 5, Core 0.12, Eval 0.213, Knowledge 22, and the matching provider adapters. Require the selected-content transfer wire contract; Interface 4 transfer records are not rewritten or silently resumed. Keep original records intact and explicitly reconstruct and review a new Interface 5 transfer request before retrying. Published Runtime 0.318 remains on the Interface 3 cohort; consumers must opt into this new minor release and qualify their receiver before enabling transfer attachment.
