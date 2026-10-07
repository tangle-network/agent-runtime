type: patch
---
`verifyAgentCandidateWorkspaceTree` reads a tree's manifest as a stream when the store offers one. A private CAS whose durable store has evicted the local copy serves it as a stream, and its buffered read may refuse, so a checkpoint capture on such a store was refused and its checkpoint kept.
