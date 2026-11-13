type: patch
---
Child tool preflight uses the resolver's declared vocabulary instead of the parent's grants, so valid per-node grants can differ. Resolvers without a vocabulary retain the child's serve-time check.
