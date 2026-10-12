# Portable workspace composition

**Workspace references.** `AgentCandidateWorkspaceSnapshotReferences` is the existing canonical candidate workspace evidence projected to manifest and archive references, without manifest material or embedded bytes. The manifest identifies file bytes and modes; the archive also identifies Git HEAD and staged state.

**Transfer source binding.** The SDK owns the public source lease, allocation and capture policy identities, and commits complete workspace references in the accepted destination. Runtime's byte-level composition receives canonical references after that boundary has validated acceptance and provenance.

**Allocation scope.** A provider-owned private destination scope held against other writers until restoration and native admission finish. Runtime refuses existing destinations and preserves competing content it observes. A directory rename alone does not provide atomic no-replace semantics.
