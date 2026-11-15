type: patch
---
A provider JSON node now settles a final message that ends in a bare JSON object after prose, as the Bridge path does: when the message has no json fence, the last object that starts a line and ends the message is the answer, so of two bare objects the last one settles. Whole JSON and a fence that ends the message settle as before. An object or a json fence followed by more text stays refused with `RUNTIME_OUTPUT_FORMAT_INVALID`.
