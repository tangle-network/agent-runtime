type: patch
---
`@tangle-network/agent-profile-materialize` is required at `^1.1.64`. Its 1.1.63 recorded every file it wrote under `.agent-profile-written/` in the candidate profile staging root, so `prepareAgentCandidateExecution` refused every candidate with "profile workspace staging files, modes, or bytes do not match the signed profile plan" in any install that resolved it (the Runtime's own lockfile held 1.1.62). 1.1.64 applies a candidate plan with `reject` and writes only the plan's files; the floor keeps a consumer from resolving 1.1.63.
