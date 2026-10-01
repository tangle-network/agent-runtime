type: patch
---
Retain a recursive external child's terminal report as unassessed evidence when its assignment has no completion check and no checked finalizer result. Parents read the durable report through await_event and observe_agent; checked submit_result and delivery progress remain unchanged.
