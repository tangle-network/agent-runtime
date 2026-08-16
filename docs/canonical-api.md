# `@tangle-network/agent-runtime`: Canonical API Reference

<!-- This file maps common jobs to the right public API.
Generated signatures and the complete export list live in docs/api/.
Run pnpm docs:freshness after editing this file. -->

> **Version 0.137.1.**
> [`docs/api/primitive-catalog.md`](./api/primitive-catalog.md) lists every export and import path.
> `agent-eval` must satisfy `>=0.145.21 <0.146.0`.
> `sandbox` must satisfy `>=0.27.1 <0.28.0`.
> Portable profile and tool-part types come from `@tangle-network/agent-interface` `^1.0.0`.
>
> **`./kernel` is the execution kernel**: `package.json` maps it to `src/runtime/index.ts`. Everything below labelled `/kernel` lives there — the recursive atom (`Scope`/`Supervisor`), the executor registry, budget conservation, the finalizer seam, analyst wiring, and the round-synchronous loop.
>
> **Read this before writing any orchestration, optimization, or measurement code in this repo.** If you are about to write a persona⟷agent conversation runner, a "skill optimizer", a "profile-seam", a depth-vs-breadth A/B harness, a bootstrap loop, or a `new Sandbox(...)` + stream + read dance: **stop**, it already exists, and a parallel copy will silently break one of the guarantees the existing primitives enforce: equal compute per compared arm ("equal-k"), the attempt-picker never being the grader ("selector≠judge"), complete usage capture, or eval running the same code path as production.

## 1. Mental model: the spine

> **Legend**: five terms the rest of this doc leans on, in plain terms:
> - **profile**: an `AgentProfile`: the whole agent as data (prompt + skills + tools + mcp + knowledge/memory). Internal design docs also call this the agent's "genome".
> - **driver ⟷ worker**: one agent (the driver) spawns and steers other agents (workers) and reads their output; both are the same building block playing different roles.
> - **conserved budget pool**: one shared compute budget split across workers, so two different topologies cost the same and a comparison is fair.
> - **combinator**: a reusable topology shape (`loopUntil` = depth/refine, `fanout` = breadth/sample) you compose instead of hand-writing a loop.
> - **holdout**: fresh problems held back from tuning, so a measured win can't be memorization.
