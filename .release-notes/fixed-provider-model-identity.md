type: patch
---
Retain observed fixed provider model IDs, including Claude Sonnet and Opus 4.6 and Claude Opus 5, as exact identities through provider execution, spawn journals, and Eval receipts. Recognition follows Eval's immutable-model policy, including Router month/day IDs such as `gpt-4-0613` and `deepseek-chat-v3-0324`, and Vertex `:date-<token>` IDs. `observedModelHasSnapshot('claude-sonnet-4-6')` now returns true. Keep the public `SnapshotKind` union unchanged; `canonicalObservedModelParts` reports fixed identities with optional `fixed: true`, a nonempty snapshot, and the unchanged provider id as `canonical`.

Fixed requests require the exact identity: an appended date or opaque token is a conflict, including `claude-sonnet-4-6-20261112` and `claude-sonnet-4-6@x`. Bridge turns with those substitutions fail; missing provider observations remain unknown. Equivalent numeric date spellings still match, while an opaque token that resembles a date stays distinct. A date suffix without a model name is unqualified.

Existing journals are not rewritten. On replay, a bare fixed-model observation previously reduced as unknown can become known. A retained attempt mixing the bare fixed id with a different dated or opaque build now reduces as a conflict, and `superviseDispatch` refuses that mixed identity. This changes evidence interpretation, not the retained observations.
