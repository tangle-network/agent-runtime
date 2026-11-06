type: patch
---
A settled record's `tree` and `spendGaps` read the whole spawn forest, so a nested driver's grandchildren appear in `tree.nodes` and stay nameable in `spendGaps` (`#1189`).
