type: patch
---
Raise the `@tangle-network/agent-interface` peer floor to ^5.10.27. Runtime depends on `@tangle-network/agent-profile-materialize` ^1.1.64, and materialize 1.1.127 (2026-11-17) raised its own Interface peer to ^5.10.27, so a consumer that met Runtime's old ^5.10.25 floor got an unmet peer once npm resolved the newest materialize; a strict-peer install refused it. The development pin, the workspace catalog and the release cohort move to Interface 5.10.27.
