type: patch
---
The per-receipt token grant stop counts a driver's committed spend (its own and its settled children's), not its children's open reservations. A parent whose child reserved its remaining grant, such as a child spawned without a budget, is no longer cancelled and failed mid-turn: its turn runs to its boundary, where the existing budget check ends the drive without a failure. A node whose committed spend reaches its grant is still cut within one usage receipt, and its spend into reservations it handed out is bounded by the turn it happens in.
