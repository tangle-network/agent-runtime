# SearchSpec: one value for every multi-agent research configuration

> **Status: decision record and slice plan.** On an architecture conflict, [architecture.md](../architecture.md)
> and [canonical-api.md](../canonical-api.md) win. This document adds no second runner, loop, or registry; it names
> the configuration space that Runtime's existing primitives already span and adds the one option and the compiler
> that make each point in it a reviewable, digest-pinned value.

## 1. Problem

Solo directors, hierarchical trees, wide swarms, collaborative peer roots, and the Stateless Language Agents design
([arXiv 2610.07625](https://arxiv.org/abs/2610.07625)) are today assembled by each consumer from `supervise`, `runGraph`,
continuation, worker slots, peer mail and analysts. Discovery Lab expands its own `topology:` and `leads:` keys into
profiles and options (`runner/play.mjs`), and writes its own continuation wording. Two consequences:

- A configuration has no name or digest, so two runs cannot be compared as "the same design on two problems", and an
  axis cannot be ablated from a shared checkpoint.
- The same expansion logic lives in more than one consumer and drifts.

## 2. Decision

A **SearchSpec** is data with seven orthogonal axes. `compileSearchSpec(spec, inputs)` maps it onto the primitives below
and returns exactly one existing call: `supervise(profile, task, options)` or `runGraph(graph, options)`.
The control loop (state, projection, scheduling, budgets, evaluation, stopping) is deterministic Runtime code.
Only agent decisions are stochastic, and each one is journaled with the digest of the input it saw.

| Axis | Values | Compiles to (existing) |
|---|---|---|
| `state` | `harness` | the coordinator journal, Knowledge, and checkpoints already hold research state; always on |
| `context` | `fresh` · `native` | continuation re-entry; **new:** `continuation.session: 'fresh'` (§3) · today's "same harness session where the backend proves it" |
| `select` | `lead` · `advisor` · `code` · `self` · `fixed` | `supervise(profile)` with a doing lead · `supervise` with an assign-only profile, `context: fresh`, isolated workers · `runGraph(graph, { brain })` · N peer roots with `peerMail` · `runGraph(graph)` |
| `workers` | `{ count, models, isolation: isolated \| shared }` | `workerSlots`, `allowedModels`, `registry.profiles` · dedicated boxes \| `sharedBoxPlacement` |
| `comms` | `assignments` · `shared-state` · `messages` | spawn briefs · Knowledge pages · `peerMail: true` |
| `evaluate` | `{ check, heldOut?, analysts? }` | `deliverable` + check · `runIsolatedCheck` · `analysts: analystsFromRegistry(...)`, `analyzeOnSettle` |
| `stop` | `{ deadline, maxBarren, until: pass \| bar }` | `continuation.deadline`, `maxBarren`, `stopRule`, `bar` |

`state: conversation` is deliberately not a value: research memory that lives only in a harness conversation cannot be
checkpointed, inspected, or ablated, and every measured long-horizon comparison in §6 favours harness-owned state.

## 3. The one new Runtime option

`supervise(..., { continuation: { session: 'fresh' } })` makes every re-entry a new harness session whose input is the
**full re-entry task** Runtime already writes when an environment is lost ("A re-entered director is told the run from the
coordinator"): the original task, the check's description, and the coordinator's run state (journal rows since the last
read, running and settled workers, pending events, the last `submit_result` refusal). The environment and its files are
kept when held; only the conversation is new. `session: 'native'` (the default) keeps today's behaviour.

The re-entry task is the projection. It is already versioned with Runtime, never quotes infrastructure failure text, and is
built by code from the journal, so it is the deterministic, role-specific context the advisor needs, with no new state.

## 4. Presets

Presets are SearchSpec values with canonical digests, recorded on registration like profile digests.

| Preset | context | select | workers | comms |
|---|---|---|---|---|
| `solo` | native | lead | 0 | — |
| `tree(W)` | native | lead | W, isolated | assignments + shared-state |
| `swarm(W)` | native | lead | W (wide), shared boxes allowed | shared-state |
| `peers(N)` | native | self | N peer roots | messages + shared-state |
| `sla(W)` | **fresh** | **advisor** | W, isolated | assignments only |

A consumer names a preset or passes an inline spec. A preset never hides an axis: the compiled options are inspectable
before spend, and the settle record carries the spec digest.

## 5. Determinism and replay contract

- Same spec digest, same inputs, same recorded decisions ⇒ same journal. A test replays recorded decisions through the
  compiled run with injected execution and compares journals.
- Any single axis can be changed on a run resumed from a shared workspace checkpoint, so an ablation measures one
  difference from the same state (the method the SLA paper used for its strongest evidence).
- Dynamic topology (a lead or advisor spawning more workers) is a recorded decision bounded by `workerSlots`, budgets and
  `allowedModels`; it never makes the control loop nondeterministic.

## 6. Evidence that sets the defaults

- SLA (Codex and Claude Code, budgets to 1B tokens): best final result on every task; isolation and explicit assignments
  each removed 10–84% of progress when ablated from shared checkpoints; the advisor used under 0.6% of tokens against
  8–11% for a long-lived coordinator. Mostly single runs; replicate before trusting widths.
- Discovery run corpus on drew-gtr-pro (about 2,000 run directories with scorecards and spawn journals): the empirical prior
  for idle time, duplicated work and worker utilization per preset.

## 7. What becomes deletable

| Consumer | Deletable once it adopts SearchSpec |
|---|---|
| Discovery Lab | the `topology:`/`leads:` expansion into profiles and options in `runner/play.mjs`; Lab-authored continuation wording that duplicates Runtime's re-entry task |
| Braid | nothing; it renders the compiled tree and the spec digest |
| Other products | per-product team assembly around `supervise` and `runGraph` |

## 8. Measurement before defaults change

Every default (which preset a product uses for which task family) changes only on a matched-token comparison with at least
three runs per arm, registered before launch, scored by a held-back check. A preset or axis that moves no measured outcome
is deleted, not kept as a knob.

## 9. Slices

1. `continuation.session: 'fresh'`; the `SearchSpec` type and validation (refuses unknown or contradictory axes with a plain
   message); `compileSearchSpec`; the five presets with digests; tests with injected execution for every preset, the
   `sla` input-isolation property (an advisor epoch's input holds the projection and no earlier turn), and journal replay.
2. Analyst placement on a checkpoint fork: `analyzeOnSettle` and `run_analyst` accept `placement: { forkOf }`, reusing the
   no-harness checkpoint fork Runtime already makes for workspace capture, so trace analysis runs beside the evidence and
   returns findings, never raw traces.
3. Discovery Lab: a `search:` play key (preset name or inline spec) that replaces `topology:`/`leads:` expansion.
4. A Discovery play that compares `solo`, `tree(4)`, `swarm(16)`, `peers(3)` and `sla(3)` on one exact-check problem at
   matched budgets.

## 10. Open questions, with recommended answers

| Question | Recommendation |
|---|---|
| Should `advisor` be a profile or code? | Both are presets: `sla` uses an assign-only profile; `select: code` uses `runGraph({ brain })` for a deterministic policy. |
| Who owns presets? | Runtime ships the five above; products add presets as data, never as code paths. |
| Does `fresh` lose useful conversation state? | Whatever the next turn needs belongs in the journal or Knowledge; a fact only a conversation holds is a state leak to fix. |
| How wide should `W` be? | Fit per task family from measured runs; the paper's widths swung by task, so no global default beyond `3`. |
