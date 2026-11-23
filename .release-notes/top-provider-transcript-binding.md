type: patch
---
`tangle top` agent inspection now reads a provider-bound native transcript capture (`binding.kind: 'provider'` with its exact `controlRef`) against the node's environment materialization, instead of reporting it as a malformed Bridge binding with missing coverage.
