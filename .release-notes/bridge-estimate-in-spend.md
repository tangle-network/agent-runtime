type: patch
---
On the Bridge transport, a turn whose usage frame carries only a producer estimate (`cost_known: false` with `estimated_cost`) now reports that estimate as `spent.usdEstimated`, inside `usd` and with `usdKnown: false`, as the provider path does; the producer's estimate replaces Runtime's catalog price for that turn instead of adding to it.
