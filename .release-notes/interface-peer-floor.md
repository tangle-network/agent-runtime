type: patch
---
The `@tangle-network/agent-interface` peer floor rises to `^5.10.2`, so an install whose lock still holds an Interface release without the bounded profile admission (Zod 54404) fails instead of resolving silently.
