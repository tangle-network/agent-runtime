type: patch
---
Restore catalog-backed compatible published ranges for Core, Knowledge and Materialize while retaining exact development pins. Align the Interface peer and catalog floor with the tested 5.2.0 development version, and select the published Interface 5.2.0 and Knowledge 22.0.1 source commits for release-cohort qualification.

Reproduce profile knowledge changes exactly when they accompany other profile resource changes, including adding, replacing or removing pinned knowledge.

Require knowledge-axis support when a compound resource change is validated against an execution materialization contract.
