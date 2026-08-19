# agent-runtime examples

Examples in this directory teach **public Runtime entry points**. They are intentionally small, mostly offline, and compile against the same package surface a consumer installs.

They are not the benchmark archive. A toy score in an example proves wiring; it does not establish that a method improves a real task distribution. Real reproduction campaigns belong in Discovery Lab.

## Canonical learning path

Run these in order:

```bash
pnpm tsx examples/stream-a-turn/stream-a-turn.ts
pnpm tsx examples/tool-loop/tool-loop.ts
pnpm tsx examples/runtime-run/runtime-run.ts
pnpm tsx examples/quickstart/minimal.ts
pnpm tsx examples/driver-loop/driver-loop.ts
pnpm tsx examples/improve/improve.ts
```

| Step | Example | What it teaches | Offline |
|---|---|---|---|
| 1 | [`stream-a-turn`](./stream-a-turn/) | one exact turn and the normalized event stream | yes |
| 2 | [`tool-loop`](./tool-loop/) | tool calls fold back into the same turn until stop | yes |
| 3 | [`runtime-run`](./runtime-run/) | one run record, cost ledger, and persisted outcome | yes |
| 4 | [`quickstart`](./quickstart/) | `runAgentRounds`: plan, execute, validate, decide | yes |
| 5 | [`driver-loop`](./driver-loop/) | the reactive fold from prior output into the next instruction | yes |
| 6 | [`supervise`](./supervise/) | a manager profile driving workers under one conserved budget | key required |
| 7 | [`graphs`](./graphs/) | fixed agent topology as data, with a traversal ledger | yes |
| 8 | [`improve`](./improve/) | one detached candidate, frozen partitions, independent final-test remeasurement | yes |

`improve` is the only canonical self-improvement example. Full-fidelity benchmark campaigns do not live under `examples/`.

## Product integration references

| Example | Use it when |
|---|---|
| [`chat-handler`](./chat-handler/) | an HTTP route must stream a chat turn and persist it |
| [`stream-backends`](./stream-backends/) | one event contract must cover in-process, sandbox, and OpenAI-compatible transports |
| [`retained-run`](./retained-run/) | the job must outlive the process that launched it |
| [`recursive-supervisor`](./recursive-supervisor/) | you need an offline view of nested agents sharing one budget |
| [`supervisor-loop`](./supervisor-loop/) | the same supervisor must switch between bridge and sandbox workers |
| [`delegate`](./delegate/) | a delegated task must settle only after a real deliverable exists |
| [`mcp-delegation`](./mcp-delegation/) | another agent needs Runtime's delegation tools over MCP |
| [`fleet-delegation`](./fleet-delegation/) | delegated workers must share a fleet workspace |
| [`knowledge-gating`](./knowledge-gating/) | execution must stop when required knowledge is below threshold |
| [`researcher-loop`](./researcher-loop/) | a domain uses the optional `agent-knowledge` peer and a hard isolation check |
| [`sanitized-telemetry-streaming`](./sanitized-telemetry-streaming/) | runtime telemetry must be useful without leaking user content |

## Specialized examples

These are valid API demonstrations but are not part of the newcomer path:

| Example | Scope |
|---|---|
| [`strategy-suite`](./strategy-suite/) | compare budget-allocation strategies against a deterministic check |
| [`product-eval`](./product-eval/) | evaluate an agent in a multi-turn simulated-user conversation |
| [`agentic-data-creation`](./agentic-data-creation/) | generate candidate training cases and keep only discriminating ones |
| [`intelligence-drop-in`](./intelligence-drop-in/) | the optional `/intelligence` wrapper and its zero-intelligence-cost off tier |
| [`intelligence-recommend`](./intelligence-recommend/) | trace findings entering the detached improvement path |
| [`agents-of-all-shapes`](./agents-of-all-shapes/) | heterogeneous framework traces converging on one telemetry contract |

The `/intelligence` examples remain available for that optional integration surface, but they are not Runtime release gates.

## Why the old benchmark examples are gone

Historical ablation rigs, WebCode dashboards, synthetic coding benchmarks, and successive self-improvement walkthroughs accumulated here over time. They mixed three jobs:

1. teaching a public API;
2. developing a benchmark adapter;
3. preserving a research result.

Only the first belongs in `examples/`. Reusable adapters and package-consumer checks live in `bench/`; preregistered campaigns, upstream reproductions, and result archives live in Discovery Lab.

## Example admission rule

A new directory is admitted only when all of the following are true:

- it demonstrates a public entry point that no existing example already teaches;
- the smallest useful form can be understood without reading a research diary;
- any score is clearly labeled as a wiring fixture unless it comes from the benchmark's own evaluator;
- it does not create a second router client, optimizer, evaluator, sandbox loop, or statistics implementation;
- it is compile-checked, and offline whenever the mechanism permits.

## Conventions

- Run from the repository root with the repository's `tsx`; examples do not carry their own package manifests.
- An absent measurement remains absent. Examples must never turn unknown usage into zero or an in-band failure into success.
- Domain checks belong to the caller. Runtime owns execution and evidence flow, not the meaning of correctness.
- `TANGLE_API_KEY` is needed only by examples that explicitly use a live Router or sandbox.

For benchmark integration and evidence levels, see [`bench/HARNESS.md`](../bench/HARNESS.md). For production improvement, see [`docs/improve.md`](../docs/improve.md).
