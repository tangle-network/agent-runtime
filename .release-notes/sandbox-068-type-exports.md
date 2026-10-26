type: minor
---
Accepts `@tangle-network/sandbox` 0.66.3 through 0.68.x as a peer. Interfaces and type aliases in `./intelligence` (`DoctorReport`, `IntelligenceClient`, `IntelligenceConfig`, `TraceHandle`, `RunReport` and related), `./placement` (`ExecutionTier`, `PlaceExecutionInput`, `PlacementContext` and related), `./tool-loop` (`RunToolLoopOptions`, `StreamToolLoopOptions`, `ToolCallContext`, `ToolCallOutcome` and related) and `./testing` fixtures are now exported as types only: import them with `import type`. None of them has a runtime value.
