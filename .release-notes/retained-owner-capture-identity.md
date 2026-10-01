type: patch
---
Retained owner cleanup validates the logical input identity and accepted native control reference separately.
Complete capture can release its exact source without treating the native execution ID as the logical Runtime ID.
Incomplete, mismatched or unbound receipts still preserve their source.
