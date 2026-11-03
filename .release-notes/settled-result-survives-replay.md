type: patch
---
A retained turn whose exact result has settled returns that result: frames past 1,024 after it are not read, and the result records incomplete observation instead of failing `unobservable`. Ten failures in a row over 5 minutes, without progress, that leave invocations pending for one cause now stop the driver `pending-unresolved` with that cause, whether or not their abandonments were confirmed and inside the outage window too.
