type: patch
---
The workspace catalog resolves `@tangle-network/sandbox` to 0.62.2 only. With the union range the lockfile kept agent-bench on 0.61.1 beside Runtime's 0.62.2, so the packed-consumer check saw two Sandbox copies and failed `verify-runtime-bench` (`Property '#private' ... refers to a different member`), which blocked the 0.331.2 and 0.332.0 publishes. Runtime's own peer range still admits 0.61.1 and 0.62.2.
