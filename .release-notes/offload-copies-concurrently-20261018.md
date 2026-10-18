type: patch
---
A private CAS `offload()` pass copies host-only objects 16 at a time. One at a time, each object cost a store round trip plus a receipt with two fsyncs: 2 objects/s on a USB drive, so one archived run of 3,563 objects held a Discovery retire pass for 30 minutes.
