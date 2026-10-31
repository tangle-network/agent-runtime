type: patch
---
Keep retained-run admission identity stable when private runtime secret strings rotate, preserving secret names, input shape, and public backend options. Separate new digest material from earlier admissions, accepted only when the caller's original material still matches exactly.
