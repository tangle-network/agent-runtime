type: major
---
Remove `ProviderWorkspaceRetentionPort`, `SandboxEvidenceRetentionPort` and their client writer configuration/cleanup callbacks, carrying the unpublished major change forward. Stop local retained subscriptions without cancelling execution or exact-result reads. Qualify the exact packed consumer before publication and bootstrap upstream evidence with the repository package-manager pin in an owned workspace.
