type: minor
---
Add complete current-object namespace inventory and reviewed retirement to the existing S3 private CAS store. Consumers fence writers and enforce evidence retention policy; retirement refuses changed inventories and reports remaining objects and payload bytes.
