type: minor
---
`continuation.session: 'fresh'` starts a new harness session on every re-entry, in the same environment with its files, whose input is the full re-entry task. `compileSearchSpec(spec, inputs)` compiles a seven-axis `SearchSpec` (or one of `searchPresets`: solo, tree, swarm, peers, sla) onto exactly one `supervise` or `runGraph` call and records `searchSpecDigest` on the run's root.
