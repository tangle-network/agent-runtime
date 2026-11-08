type: patch
---
A JSON-output provider turn that ended before its event stream was wholly read now settles failed with `RUNTIME_OUTPUT_FORMAT_INVALID` instead of staying a pending retained execution, so the next attempt runs a fresh execution rather than re-reading the same stream until the driver's attempts run out.
