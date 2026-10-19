type: patch
---
A run cancelled before it is re-entered settles `no-winner` / `cancelled` from its journal, with no executor recovery, turn or environment, and its cancellation reads `cancelled`. A resumed run whose request was acknowledged only as `cancel_requested` by a process that died is aborted again. Before, such a resume threw on the aborted recovery, and the next one re-ran its work to budget exhaustion (queens21-h22-tree4-20261018a).
