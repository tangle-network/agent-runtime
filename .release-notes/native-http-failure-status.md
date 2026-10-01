type: patch
---
Preserve native HTTP failure status in supervised executor outcomes. A reported HTTP 400 ends the failed driver turn without another identical attempt; HTTP 408 and 5xx keep their existing retry behavior, and 429/503/529 keep capacity pauses.
