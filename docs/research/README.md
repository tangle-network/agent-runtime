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
| [observed-orchestration-patterns.md](./observed-orchestration-patterns.md) | Mining of 174 real workflows / 496 agent calls across 9 projects + Codex: the 6 orchestration shapes, driver=leaf confirmed, persona/policy needs NO new type, and the real bottleneck (cross-run memory + a leaf-fanout-confounded equal-k gate). |
| [architecture-alternatives.md](./architecture-alternatives.md) | 6 paradigms (blackboard, market, active-inference, QD, Gödel-machine, debate) steelmanned vs the recursive-atom tree. **Verdict: keep the tree, graft 6 ideas, replace only when a domain has a total verifier.** The signal-first revised phase plan. |
| [belief-state-learner-spec.md](./belief-state-learner-spec.md) | **The belief-state / program-synthesis layer (deferred-learner spec).** Blueprint for the cross-run learner, stress-tested against the shipped substrate. **Status: BUILD-ON-GREEN** — waits on a positive diverse@k-vs-blind gate; this is its design, not a build order. |
| [belief-agent-research-agenda.md](./belief-agent-research-agenda.md) | Research agenda for the recursive/belief-state agent — 7 disciplinary lenses → ranked agenda, grounded against the gate result (judge-blind selection loses; the win needs a deployable checker). Top tier is **offline on committed corpora**; the learner tier is gated. |
| [program-research-plan.md](./program-research-plan.md) | Formal fund-or-kill audit of the program-synthesis framing. The honest verdict: **kill the RSI frame, park orchestration, ship the instrument + abstention.** |
| [codex-techniques-audit.md](./codex-techniques-audit.md) | Adoption report mining OpenAI Codex for succinct-code principles + orchestration techniques. **Advisory** — verify `file:line` before acting. |
| [loop-facade-postmortem.md](./loop-facade-postmortem.md) | Failure record for the deleted `defineLoop` facade: why retyping `Scope`/MCP/journals/validators produced code without substrate proof, and the prevention rule for future loop APIs. |

### The optimization-space suite (2026-06-09)

The strategy map + per-layer stress tests, written after the steering/GEPA gate series.
Start at the index; each layer doc carries its own evidence table, strongest objections,
and concrete next experiments.

| Doc | What it holds |
|-----|---------------|
| [optimization-space.md](./optimization-space.md) | **The index.** The 6-axis taxonomy (timescale · target · objective · validity scope · serving architecture · authorship), the evidence map (which cells are measured/null/empty), the canon-compatibility audit, and the ranked experiment portfolio. |
| [layer-within-run.md](./layer-within-run.md) | Within-run optimization — the settled boundary law (steering negative on stateless, positive on stateful+keep-best), the two engineering laws (checkpointing; architecture-is-a-variable), and the one open lever (topology tournament). |
| [layer-across-run.md](./layer-across-run.md) | **The unmeasured thesis (n=0).** The corpus flywheel: primed-vs-cold A/B design, the four falsifiers (context pollution, stale facts, judge leakage, worker disregard), and why this layer dominates the portfolio. |
| [layer-economics.md](./layer-economics.md) | Multi-objective + cost: the largest practice-vs-canon inconsistency (all gates single-objective; canon mandates the vector), the lift-per-dollar frontier, and the tool-augmentation effect (+70pp) that dominates everything else measured. |
| [layer-domain-generality.md](./layer-domain-generality.md) | The n=1-domain exposure of the headline result; the nearly-free cross-domain replication (csm/hr gym splits); why itsm may be idiosyncratic; the product-transfer falsifier. |
| [layer-intelligence-serving.md](./layer-intelligence-serving.md) | Self-hosted vs platform-served intelligence: Tangle Intelligence is export-only today; the timescale split (in-loop critic local, across-run memory served); the four-gap list incl. the **server-side judge firewall** as the non-negotiable. |
| [layer-agent-authored.md](./layer-agent-authored.md) | Skillification: agent-authored strategies via `defineStrategy`, the two structural safety properties (conserved budget, firewall), and the R0→R3 success ladder for the strategy-author skill. |
| [product-integration-playbook.md](./product-integration-playbook.md) | **The operator playbook.** The 8-step product integration sequence (gtm first), the consolidated human-role table (what only operators do), the three packaging gaps (publish the suite, corpus inflow, product Environments), and fleet sequencing. |

## Source artifacts (multi-agent passes)

| Run | Pass | Result lands in |
|-----|------|-----------------|
| `w9ntld2vt` | deep-research benchmark survey (102 agents, 20 sources, 25 claims adversarially verified) | long-horizon-benchmark-survey.md |
| `wuh46e5zp` | durable-architecture design — 3 proposals → adversarial synthesis | flat-harness-design.md |
| `wnrxtvdta` | recursive-atom-surface — 6 prior-art lenses + 4 codebase mappers → synthesis → adversarial critique → reconcile | recursive-execution-atom.md (appended on completion) |
| `w1x80539n` | belief-state learner — theory + subtractive-architecture + data-science + red-team lenses → adversarial synthesis → reconcile | belief-state-learner-spec.md |
| `wmzhyr5bg` | belief-agent agenda — 7 disciplinary lenses → adversarial slop-filter → ranked agenda | belief-agent-research-agenda.md |
| `w1mo90utm` | program research plan — kill-it red-team + steelman + intent-archaeology + infra-auditor → synthesis | program-research-plan.md |

## Decision log

- **Full tensor now**, not "not-foreclose / flat-v1." The architecture must *be* the recursive
  execution atom now, built as durable mechanism (so it survives even a negative gate), not a
  flat harness with seams. _(interview, 2026-06-04)_
- **Plane B contains Plane A.** We do not pick "experiment harness" or "recursive atom" — the
  flat harness is the simplest `act` body over the atom. The `wuh46e5zp` design becomes the
  canonical example, not a competing v1.
- **Analyst = Agent + harness.** Halo-CLI / our inline trace-analyst / a sandboxed agent are
  one type. The runtime is **derived from the agent's `AgentProfile.harness`**: `harness: null` =
  direct Router inference call; `harness: <sandbox>` = sandboxed; future `mastra`/`agno`/`ai-sdk`
  harnesses register their own `Executor`. _(operator, 2026-06-04)_
- **Leaves are opaque, self-parallelizing coding harnesses.** The recursion is in the *drivers*;
  the bottom is a coding agent that fans out internally on its own.
- **The 4 forks resolved (operator, 2026-06-04):** event-sourced **yes**; observability **substrate
  now**; LLM meta-driver **built now** (operator override of the pass's "make it wait"), as the
  *treatment* on top of the budget-reservation invariant, with coded progressive-widening +
  flat-harness as controls; hard ceiling **yes — sharpened to a conserved reservation pool**
  (`Σk(treatment) ≡ Σk(blind)` by construction, fail-closed).
- **The keystone is the budget-conserving reactive `Scope` + `Supervisor`** (not the LLM driver).
  The critique proved a *ceiling* budget + data-dependent spawning is a confound generator; the
  conserved *reservation* pool is the one invariant that makes any meta-driver result valid.
  `WidenGate` defaults to flat so the selector≠judge firewall conflict (R2) stays dormant until
  widening is argued. See [recursive-execution-atom.md](./recursive-execution-atom.md) for the
  frozen surface + build order.

## Open engineering forks (not blocking the v1 keystone)

- **F1** — does `Scope` supersede `runProgram`'s loop-layer `parallel`, or coexist? (deletion deferred until `Scope` is proven)
- **F2** — adopt a Temporal/DBOS durable backend now, or type-shape-only until days-long resumable runs are a near-term product?
- **F3** — is `cli`/Halo a first-class equal-k participant (needs external-process token accounting first) or observability-only (`budgetExempt`, permanent)?
