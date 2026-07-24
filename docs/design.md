# Design philosophy

Background reading: why the package is shaped the way it is.
None of this is required to use the library — for that, start at the [README](../README.md), [concepts.md](./concepts.md), and [canonical-api.md](./canonical-api.md).

## The idea in plain terms

1. **One recursive building block.**
A "driver" runs workers, reads their real output, and composes the next step from it.
Chat turns, one-shot tasks, supervised teams, and self-improvement runs are all this same block at different depths — "driver", "worker", and "coordinator" are roles one agent plays, not separate types.
2. **The agent is data.**
An agent is fully described by its `AgentProfile` (prompt + skills + tools + MCP servers + hooks + subagents + memory + model).
You change behavior by changing the profile, and because it is data, an optimizer can search over it.
Internal docs call this profile-as-data idea the agent's "genome".
3. **Every run is measured.**
Each run records tokens, dollars, time, and a pass/fail score from a real check, so "better" is always a number with a denominator.
4. **Improvement must be proven, not claimed.**
A candidate change ships only when it beats the current agent on fresh tasks no tuning step ever saw, under a statistical test.
Two honesty rules hold everywhere: whatever gives feedback never sees the answer key, and the model that picks the best attempt is never the model that grades it.
5. **Comparisons are fair by construction.**
Competing topologies draw from one shared compute budget, so "smarter coordination" can never win just by spending more.

## The spine, in its original compressed form

The internal one-sentence statement of the whole system, preserved from the API reference (each bolded term is defined there in plain words):

> A **genome** (an `AgentProfile`: `systemPrompt + skills + tools + mcp + knowledge + memory + rag` — one combined surface) is run as a **driver⟷worker conversation** (`runPersonified` composing a combinator like `loopUntil`/`fanout` over the keystone `Supervisor` — K rounds spent against one persistent, journaled artifact on a *conserved budget pool* so equal-compute holds by construction) over a **benchmark** (the `ADAPTERS` registry driven by `runGate` over the Supervisor, or an `AgenticSurface` driven by `runBenchmark`/`runAgentic`), then **optimized by a gated loop** (`selfImprove`/`runImprovementLoop` + `gepaProposer`, certified by `defaultProductionGate`/`heldOutGate`/`promotionGate`, or the full multi-generation `runStrategyEvolution`) that evolves the genome and **certifies wins on a frozen holdout** — never on the training composite.

## The internal design and research docs

These are working documents for the team building the package: they contain project narrative, research theses, internal experiment results (whose raw data lives in private state files and is not reproducible from this repo alone), and roadmap bookkeeping.
Read them to understand or extend the internals, not to use the API.

| Doc | What it is |
|---|---|
| [architecture.md](./architecture.md) | The internal design document: the recursive agent tree, the two improvement timescales, and the success criteria the team holds itself to. Wins on any conflict between docs. |
| [architecture-interpretations.md](./architecture-interpretations.md) | A self-critique: the same design read through five independent lenses, including an adversarial one. |
| [learning-flywheel.md](./learning-flywheel.md) | The research thesis on cross-run learning — why the outer improvement loop, not any single run, is the product. |
| [roadmap-rsi.md](./roadmap-rsi.md) | The phased build plan for the self-improvement surface, with exit gates and open decisions. |
| [eval-substrate.md](./eval-substrate.md) | The measurement principles: neutral scoring, honest graders, and what the team refuses to claim without held-out evidence. |
| [agent-managed-compute/](./agent-managed-compute/) | The distributed-execution plan for agents that allocate and steer compute. |
| [design/](./design/) · [research/](./research/) · [archive/](./archive/) | Accepted design notes, forward-looking research threads, and retired plans kept for history. |
