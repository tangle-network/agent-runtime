type: minor
---
`resolveDeliverable` can return `null` to run a child without inheriting the root completion check or continuation.
Use explicit compatible child tools with `inheritSpawnRights: false`; unavailable completion grants remain refused.
Returning `undefined` still inherits the run-wide completion check.
