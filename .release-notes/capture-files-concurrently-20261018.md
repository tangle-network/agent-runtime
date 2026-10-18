type: patch
---
A workspace tree capture stores its files 16 at a time and each distinct file once. Every file's put waits for its own durable copy, so capturing one file at a time cost a store round trip per file (one 2 KB file per 1.8 s in Discovery retire salvage on drew-gtr-pro).
