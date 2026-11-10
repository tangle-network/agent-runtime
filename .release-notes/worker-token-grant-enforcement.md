type: patch
---
A worker's token grant is enforced inside its turn: after each usage receipt, a driver node whose charged tokens (input − cacheRead + output) reach its grant is stopped through its budget stop, which cancels the native run, so it overspends by at most one receipt. A harness that reports usage only when its turn ends is still bounded by that turn. Settlement now exposes `ownSpent` on each tree node (its own work, without descendants; `spent` stays the subtree its grant bounds) and `spentSplit: { root, children }` on the result, each counting every node once.
