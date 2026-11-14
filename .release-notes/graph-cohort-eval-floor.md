type: patch
---
Raise the `@tangle-network/agent-eval` peer floor to ^1.0.32: 1.0.31 is the first Eval release with the shared final-evidence policy (`captureFinalEvidencePolicy`, `prepareSearchFinalEvidence`) that native search now binds to its search identity, and 1.0.32 is the first whose run reader takes a native capture's attempt from its `execution-evidence` row, where Runtime now writes it. The development pin, the workspace catalog and the release cohort move to Eval 1.0.32.
