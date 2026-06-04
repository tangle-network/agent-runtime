> **Track:** Architecture (research) · **Role:** design-research log · **Status:** open — keystone design in flight

# Research log — RSI driver architecture

Design research for the next architecture generation: turning the flat experiment harness
into a **recursive execution atom** (agents that drive agents, recursively; analysts as
agents; an async, observable, dynamically-spawning supervision tree). This dir tracks the
inputs (surveys, design passes), the decisions, and the open forks so the thread is
resumable and the expensive multi-agent passes are not re-run.

On any *architecture* conflict, [`../architecture.md`](../architecture.md) still wins. These
docs are forward-looking design research, not the canonical spine — promotions into the
spine happen explicitly, with `file:line` anchors, once a design ships.

## Documents

| Doc | What it holds |
|-----|---------------|
| [recursive-execution-atom.md](./recursive-execution-atom.md) | **The main thread.** The vision (verbatim intent), the Plane-A-vs-B framing, the proposed surface (one atom + `Scope` + `Supervisor`), analyst-as-agent-with-runtime, what exists vs the gap (file-grounded), the open questions, and the decision log. |
| [flat-harness-design.md](./flat-harness-design.md) | **Plane A.** The assumption-free experiment-harness synthesis (profiles × steer × executionMode × allocation; rip-out list; durability argument; migration phases). Recovered as the simplest `act` body on Plane B. |
| [long-horizon-benchmark-survey.md](./long-horizon-benchmark-survey.md) | Adversarially-verified survey of long-horizon + multi-turn benchmarks. Top picks: **Commit0** (graded + natively multi-turn software build), **τ²-bench** (multi-turn agent↔user with tools). |

## Source artifacts (multi-agent passes)

| Run | Pass | Result lands in |
|-----|------|-----------------|
| `w9ntld2vt` | deep-research benchmark survey (102 agents, 20 sources, 25 claims adversarially verified) | long-horizon-benchmark-survey.md |
| `wuh46e5zp` | durable-architecture design — 3 proposals → adversarial synthesis | flat-harness-design.md |
| `wnrxtvdta` | recursive-atom-surface — 6 prior-art lenses + 4 codebase mappers → synthesis → adversarial critique → reconcile | recursive-execution-atom.md (appended on completion) |

## Decision log

- **Full tensor now**, not "not-foreclose / flat-v1." The architecture must *be* the recursive
  execution atom now, built as durable mechanism (so it survives even a negative gate), not a
  flat harness with seams. _(interview, 2026-06-04)_
- **Plane B contains Plane A.** We do not pick "experiment harness" or "recursive atom" — the
  flat harness is the simplest `act` body over the atom. The `wuh46e5zp` design becomes the
  canonical example, not a competing v1.
- **Analyst = Agent + runtime.** Halo-CLI / our inline trace-analyst / a sandboxed agent are
  one type with a `runtime` of `'cli' | 'inline' | 'sandbox'`, not three subsystems.
- **Leaves are opaque, self-parallelizing coding harnesses.** The recursion is in the *drivers*;
  the bottom is a coding agent that fans out internally on its own.

## Open forks (awaiting the user)

1. **Event-sourced/replayable supervisor** (recommended yes) vs best-effort live observability.
2. **Conversation now** vs queryable-substrate-now / chat-client-later (recommended: substrate now).
3. **Spawn policy = code** (recommended default) vs LLM meta-driver shipped as default (recommended: opt-in only — mechanism-ahead-of-the-gate).
4. **Global budget as a hard, fail-closed ceiling** (recommended yes) governing progressive widening.
