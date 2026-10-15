# SearchSpec: one value for every multi-agent research configuration

> **Status: decision record; slice 1 shipped.** On an architecture conflict, [architecture.md](../architecture.md)
> and [canonical-api.md](../canonical-api.md) win. This document adds no second runner, loop, or registry; it names
> the configuration space that Runtime's existing primitives already span and adds the one option and the compiler
> that make each point in it a reviewable, digest-pinned value. The code is `src/runtime/supervise/search-spec.ts`
> (`compileSearchSpec`, `searchPresets`, `searchSpecDigest`) and `ContinuationPolicy.session`.

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
| `context` | `fresh` · `native` | `continuation.session`: **new** `'fresh'` (§3) · `'native'`, today's "same harness session where the backend proves it" |
| `select` | `lead` · `advisor` · `self` · `code` · `fixed` | `supervise(profile)` with a doing lead · `supervise` with `maxDepth: 1` and `inheritSpawnRights: false`, `context: fresh` · `supervise` whose root convenes the peers in `registry.profiles`, `comms: messages` · `runGraph(graph, { brain })` · `runGraph(graph)` |
| `workers` | `{ count, models?, isolation: isolated \| shared }` | `workerSlots: count` (absent at 0), `allowedModels: models` · every worker in its own environment \| the provider backend's `shared` placement (`sharedBoxPlacement`) |
| `comms` | `none` · `assignments` · `messages` | no workers · spawn briefs down and results up · plus `peerMail: true` |
| `evaluate` | `{ feedback: verbatim \| off, bar: on \| off, analysts? }` | `continuation.failures`, `continuation.bar`, `analyzeOnSettle: analysts` over the `analysts` registry |
| `stop` | `{ maxBarren, plateau? }` | `continuation.maxBarren`, `stopRule: { plateau }` |

The problem stays outside the spec, as `compileSearchSpec` inputs: the root profile and task (or a graph's nodes and
edges), the budget, the check, the continuation deadline and note words, the named worker profiles, and every other
option of the call (`backend`, `coordination`, `runDir`, ...). An input for an option an axis decides is refused.

The compiled call records the spec's digest as the root's `execution.correlation.searchSpecDigest`, the mechanism a
fork uses for its lineage keys. The journal's root `spawned` record carries it, and the settle record carries the root's
whole attribution as `execution`, so `result.json` alone says which design a run was.

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

It lives where the same-session choice already lived, so there is no second continuation loop:

- The drive harness's statement of continuity (`reentryContinuity` in `supervise.ts`) is unchanged; under `fresh` a
  proven `continued` session becomes `new`, so `composeReentryTask` writes the full task. `supervisorAgent` also forces
  `new` for a caller's `driveHarness`, which receives the policy as `session` on every drive.
- A bridge keys its conversation by session id, so a fresh re-entry binds a session id derived from the owner's attempt
  id, which is new for every re-entry and every process.
- A retained provider owner keeps its live environment (`existingEnvironmentId`) and mints the new session's identity
  from the invocation's own keys, as a first invocation does (`RetainedExecutorContext.newSession`). The choice is
  derived from the policy and the journal, so a recovered invocation replays the identity it committed.
- A replaced environment was already a new session; nothing changes there.

Not covered: the first drive of a resumed process is not a re-entry in Runtime, so it is sent as it is today (the
original task) under either policy. Making it a fresh re-entry with the full task is a follow-up.

## 4. Presets

Presets are SearchSpec values with canonical digests (`searchSpecDigest`: sha256 of RFC 8785 JSON of
`{ kind: 'agent-runtime.search-spec.v1', spec }`, lists sorted), recorded on registration like profile digests. Every
preset shares one `evaluate` and one `stop` value, read in `searchPresets` (`search-spec.ts`): the FAIL lines verbatim,
no bar section, and the continuation's own measured `maxBarren`. An inline spec that changes either has its own digest.

| Preset | context | select | workers | comms |
|---|---|---|---|---|
| `solo()` | native | lead | 0 | none |
| `tree(W)` | native | lead | W, isolated | assignments |
| `swarm(W)` | native | lead | W, shared boxes allowed | assignments |
| `peers(N)` | native | self | N peers | messages |
| `sla(W)` | **fresh** | **advisor** | W, isolated leaves | assignments |

`tests/kernel/search-spec.test.ts` pins each preset's digest, computed independently of the TypeScript serializer, so a
change to a preset's value is a visible test change rather than a silent new design.

A consumer names a preset or passes an inline spec. A preset never hides an axis: the compiled options are inspectable
before spend, and the settle record carries the spec digest.

## 5. Determinism and replay contract

- Same spec digest, same inputs, same recorded decisions ⇒ same journal, apart from wall-clock fields and the kernel's
  random per-attempt ids. A test replays recorded decisions through the compiled run with injected execution and
  compares journals.
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

1. **Shipped.** `continuation.session: 'fresh'`; the `SearchSpec` type and validation (refuses unknown or
   contradictory axes with a plain message); `compileSearchSpec`; the five presets with digests; tests with injected
   execution for every preset, the `sla` input-isolation property (an advisor epoch's input holds the projection and no
   earlier turn), fresh against native on one retained environment, and journal replay
   (`tests/kernel/search-spec.test.ts`, `tests/kernel/fresh-session-reentry.test.ts`).
2. Analyst placement on a checkpoint fork: `analyzeOnSettle` and `run_analyst` accept `placement: { forkOf }`, reusing the
   no-harness checkpoint fork Runtime already makes for workspace capture, so trace analysis runs beside the evidence and
   returns findings, never raw traces.
3. Discovery Lab: a `search:` play key (preset name or inline spec) that replaces `topology:`/`leads:` expansion.
4. A Discovery play that compares `solo`, `tree(4)`, `swarm(16)`, `peers(3)` and `sla(3)` on one exact-check problem at
   matched budgets, scored by a held-out check.

What slice 1 changed from the first draft of this record, and why:

- `comms` is one value, not a set. Runtime serves no store shared between workers that a run could switch on or off:
  workers share files through a shared box (`workers.isolation`) and share pages through the Knowledge namespace the
  consumer mounts, which is the consumer's input. `assignments` is always how a selector reaches a worker. So the only
  channel a spec can switch is peer mail, and `shared-state` would have digested a value no compiled option reads.
- `evaluate.heldOut` is not an axis. A held-out score judges a settled run (`versions.judge`, `declaredCheckJudge`,
  `runIsolatedCheck`), outside the run's call, so it belongs to the comparison (slice 4), not to the design.
- `stop.until: pass | bar` became `evaluate.bar`. A run with a check ends on a pass or a bound either way; `bar` only
  adds the bar section to the continuation note. The deadline moved to the inputs: it is the matched budget, and an
  absolute time would give two runs of one design two digests.
- `select: self` compiles to `supervise`, not `runGraph`: a graph pins every spawn to its nodes, so a peer could not staff
  its own team.
- Every root under `lead`, `advisor` or `self` must run an external harness, because the continuation that carries
  `context`, `evaluate` and `stop` drives only external managers; a router root is refused rather than silently
  ignoring three axes.
- `comms: messages` is refused for workers that cannot mount peer mail. Runtime mounts it on `bridge` workers; a
  `provider` worker runs no client for it. Mounting peer mail as a provider runtime attachment, the way the coordination
  server rides `runtimeAttachments.mcp`, is the follow-up that makes `peers(N)` run on Tangle sandboxes.

## 10. Open questions, with recommended answers

| Question | Recommendation |
|---|---|
| Should `advisor` be a profile or code? | Both are presets: `sla` uses an assign-only profile; `select: code` uses `runGraph({ brain })` for a deterministic policy. |
| Who owns presets? | Runtime ships the five above; products add presets as data, never as code paths. |
| Does `fresh` lose useful conversation state? | Whatever the next turn needs belongs in the journal or Knowledge; a fact only a conversation holds is a state leak to fix. |
| How wide should `W` be? | Fit per task family from measured runs; the paper's widths swung by task, so no global default beyond `3`. |
