type: minor
---
Runtime moves to the agent-interface 3 cohort: `@tangle-network/agent-interface` `^3.0.0`, `@tangle-network/agent-core` `>=0.10.3 <0.11.0`, `@tangle-network/agent-eval` `>=0.209.1 <0.210.0` and `@tangle-network/agent-knowledge` `^20.0.0`. agent-core 0.10.3 requires agent-interface 3, so a consumer on the 2.x line installed two agent-interface copies. agent-interface 3.0.0 removed only exports nothing imported; Runtime used none of them.
