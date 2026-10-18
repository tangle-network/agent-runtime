type: patch
---
An exact result wakes a retained turn at once again on a quiet stream: 0.325.4 through 0.325.9 held a stream that owed its terminal frame open for up to five seconds after its exact result. A stream now reads on after its exact result only while its frames keep arriving, each within 100 ms of the last, so a burst sent with the result is read whole and a quiet or frameless stream closes on the result at once.
