type: patch
---
A run no longer continues in a kept environment its provider does not confirm running: when a reopened or restarted run, or a seat change, finds the owner's environment released but not destroyed and not running, Runtime journals it retired (`environment-teardown` with `retired: true`), never sends a seat or invocation back there, and continues in a new environment and harness session restored from the newest checkpoint, without the conversation. A seat asks for a native turn grant only when a retained environment remains to continue.
