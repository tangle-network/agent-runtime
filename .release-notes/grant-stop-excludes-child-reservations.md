type: patch
---
The per-receipt token grant stop counts a driver's committed spend (its own and its settled children's), not its children's open reservations: a parent whose child reserved its remaining grant, such as a child spawned without a budget, keeps its turn and waits on the child at the turn boundary instead of being cancelled and failed. A node's own overspend is still cut within one usage receipt.
