type: patch
---
A steer a manager reads in `read_journal` is delivered to that attempt, so `submit_result` is no longer refused with `open-work` for steers it already read. `EventBus` gains an optional `take(seq)`.
