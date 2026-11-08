type: patch
---
A provider JSON node whose final message ends with one fenced JSON block (```json or bare ```) settles that block; bare JSON settles unchanged, and any text after the fence stays refused with RUNTIME_OUTPUT_FORMAT_INVALID.
