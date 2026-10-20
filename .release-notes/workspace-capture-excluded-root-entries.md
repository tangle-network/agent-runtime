type: patch
---
`captureAgentCandidateWorkspaceToArtifacts` and `captureAgentCandidateWorkspaceTreeToArtifacts` take `excludedRootEntries`: top-level entries of the root left out of the capture by name, such as a provider's retained native sessions (`__retention__`) that the native capture already keeps, or a rebuildable virtualenv. On Discovery canary 20b these were 24 to 27 MB of each 25 to 27 MB workspace capture; the agent's own files were under 0.2 MB.
