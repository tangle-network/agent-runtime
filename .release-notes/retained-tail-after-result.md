type: patch
---
A retained turn now reads its provider stream's terminal frame when it lands just after the exact result on the other connection, instead of closing a quiet stream at once and recording the event stream as incomplete.
