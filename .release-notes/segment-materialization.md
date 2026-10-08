type: patch
---
A root resumed on another segment (`supervise({ segment })` with another model, effort or harness) now drives on it: its materialization stays attributed to the registered root profile, the segment is materialized once after its `root-segment` record (a `seat-materialized` record), and a resume reads the root's latest materialization. Before, every drive of such a root on the Tangle provider was refused "scope owner materialization changed mid-run" until its retry bound.
