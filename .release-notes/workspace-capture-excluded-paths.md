type: patch
---
`captureAgentCandidateWorkspaceToArtifacts` and `captureAgentCandidateWorkspaceTreeToArtifacts` take `excludedPaths`: root-relative files or directories left out of the capture, each by its exact path, such as a provider's retained native session tree (`__retention__/sessions/<id>`) that the native capture already keeps, or a rebuildable virtualenv (`.venv`). On Discovery canary 20b these were most of each 25 to 27 MB workspace capture; the agent's own files were under 0.2 MB.
