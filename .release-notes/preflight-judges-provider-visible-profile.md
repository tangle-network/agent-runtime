type: patch
---
The spawn pre-flight now judges the profile the provider will receive. With provider-tangle 5.0.10's create verdict, it refused every worker that declared `seats` or `agent_runtime_coordination_*` tools, so managers stripped their workers' tools until a spawn passed (canary-chain-20261104q through v).
