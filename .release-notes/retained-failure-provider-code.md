type: patch
---
A retained child that settles pending (for example a dispatch the platform refused with HTTP 503) now keeps the provider's machine code on its settled failure and in the result tree, instead of only the synthetic transport cause.
