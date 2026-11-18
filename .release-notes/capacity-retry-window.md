type: patch
---
The provider executor takes `capacityRetryWindowMs`: how long a retained execution waits for room after Sandbox refuses it placement (a 503 such as `CAPACITY_EXHAUSTED`) while it is acquired or observed, before the refusal counts as a failed attempt. The default stays 10 minutes, so every existing caller waits as before, and acquisition in a run with a deadline still waits until the deadline instead. A value that is not a non-negative number fails the executor's construction with a `ValidationError`, whatever the provider.
