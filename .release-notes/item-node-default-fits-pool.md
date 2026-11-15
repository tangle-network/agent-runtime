type: patch
---
A spawn that names no budget reserves at most what the pool can admit: when its default slice does not fit, each short channel is lowered to the pool's free plus held amount instead of refusing. With one worker slot the default slice is the whole pool, so the second node of a `maps` item flow (for example a reader, then its verify) was refused once the first had spent from the item's `itemBudget`. A spawn that names its budget keeps the refusal.
