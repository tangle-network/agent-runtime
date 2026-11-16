type: patch
---
Retained execution observation now reports a failed exact-result read with its provider cause instead of claiming the stream outlived a result that never arrived. The existing retry and reconciliation behavior is unchanged.
