type: patch
---
A retained owner keeps its box when the final native session copy is incomplete (`nativeStore` not complete, or an `over_bound:` / `store_file_` reason) and journals `environment-teardown` with `destroyed: false` and that reason. Process I/O or event-log gaps alone still allow release to destroy the box.
