type: patch
---
Publishes 9.0.5's rate-limit hold. The 9.0.5 tag never reached npm: its packed-consumer check resolved `@tangle-network/agent-profile-materialize` 1.1.103, published a minute before, whose `@tangle-network/agent-interface` peer floor ^5.10.23 refused the 5.10.22 development pin. Runtime source and its published ranges are unchanged.
