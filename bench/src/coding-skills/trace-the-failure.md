---
name: trace-the-failure
description: When a test or program fails, read the traceback from the top error to the deepest frame in your own code, and fix at the root.
---
On a failure with a stack trace:
1. Read the actual exception type and message first.
2. Walk the frames to the DEEPEST one inside the code under test — that's usually where the root cause is, not the top frame.
3. Inspect the values at that frame (add a print/log if needed) before editing.
4. Fix the root cause, not the symptom that surfaced higher up.
