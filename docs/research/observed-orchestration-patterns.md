> **Track:** Architecture (research) · **Role:** grounding artifact for the recursive-atom keystone · **Status:** evidence synthesis — maps mined orchestration behavior onto the frozen `Scope`/`Supervisor` surface

# Observed orchestration patterns — the recursive atom, grounded in what we actually run

This is the evidence file behind [`recursive-execution-atom.md`](./recursive-execution-atom.md). That
doc froze a surface from prior art and 4 design lenses; this doc validates it against **what Drew's
agents (Claude + Codex) actually do in production** — 174 unique dynamic workflows orchestrating 496
agent calls across 9 projects, plus 667 Codex sessions and ~1,557 sandbox-leaf sessions. The keystone
(`src/loops/supervise/{types,scope,supervisor,budget,runtime}.ts`, committed `06efe71`, PR #151) is read
as the ground truth; where a story needs something the keystone doesn't have, that's flagged as a gap,
not hand-waved.

**BLUF — read this even if you read nothing else.** The recursive-atom *expressiveness* claim survives:
six recurring orchestration shapes all reduce to `spawn` + `next` + a coded selection policy over `Scope`,
and `driver = leaf = one Agent` holds in the wild. **But expressiveness was never the bottleneck.** Three
facts from the corpus reframe the work:

1. **We are building for the rarest observed shape, on purpose.** The dominant real shape is
   **driver-pipeline (77% of 174 workflows)**. The async/heterogeneous-budget *recursion* the keystone
   optimizes for is **~0.5% (3 workflows)**, observed depth **≤ 2** (Codex caps at depth 1). The keystone
   targets a shape the corpus barely exhibits — a deliberate "build the general mechanism now" bet, not a
   response to observed demand. Lead with this when deciding whether to fund deeper recursion.
2. **The keystone's own validity claim — `Σk(treatment) ≡ Σk(blind)` (the conserved-budget pool) — is
   confounded by observed behavior.** Leaves self-parallelize (worktree sub-agents, within-turn tool
   batching) with their *own* uncounted scheduler. The conserved pool cannot see leaf-internal fanout, so
   the equal-k gate the whole project rests on is **measuring an `k` it does not actually control.** This
   is a threat to validity drawn from observed traces, not a hypothetical (see §2 and the threats table).
3. **The bottleneck is cross-run memory, not orchestration.** Four of five user stories — and *both*
   stories that need any new machinery at all — are blocked on **one** missing seam: a durable cross-run
   `Corpus` (the read side of the learning flywheel). Without it the system is a *nicer within-run
   orchestrator*, and the repo's own gate memory says within-run orchestration shows ~0 coding-headroom and
   that steering loses at equal compute. The atoms can *express* the orchestration; the orchestration is
   not what turns this into "an RSI that acts like Drew."

So: persona/strategy/policy need **no new type** (§4); the missing 20% is named seams, not a redesign
(§5). But the headline is not "the mechanism is elegant" — it is *the mechanism is sufficient and not the
constraint; the constraints are cross-run memory (deferred by discipline) and a clean, leaf-fanout-honest
equal-k gate.*

---

## 1. Observed orchestration taxonomy

The recurring dynamic-workflow SHAPES, with frequency and altitude. "DRIVER-layer" = the shape
orchestrates sub-loops (it is an `act` that calls `scope.spawn`/`scope.next`). "LEAF-layer" = a single
agent parallelizing its *own* tool calls inside one `execute` (opaque to us — the coding harness's own
sub-agents). Counts are from the mined corpus; cited evidence is the strongest single instance. Read the
**Freq** column against the BLUF: pipeline dominates; the recursive shape the keystone targets is the tail.

| # | Shape | Freq (mined) | Layer | What it is | Reduces to |
|---|-------|--------------|-------|------------|------------|
| 1 | **driver-pipeline** (chain: A→B→C, output feeds downstream) | **77% of 174 workflows** | DRIVER | sequential phases; e.g. inventory→discover, research→design→build | `seq` of `spawn`+`await next()`, each child's `out` is the next child's `task` |
| 2 | **fanout** (N independent children, then fan-in synthesize) | **~0.5% pure (3 workflows)**; larger N when it appears (5 / 9–15 / 14 children) | DRIVER | one child per app/domain/lens/skill, collect, synthesize | N× `spawn` then a loop of `next()` to drain, then a `synthesize` spawn or local merge |
| 3 | **loop-until** (iterate until gate/budget) | **5% (≈9 workflows)**; avg 2.7 agents/iter | DRIVER | rewrite→grep-verify→loop; the GEPA refine loop | `while(scope.budget…){ spawn; await next(); decide }` — the conserved pool IS the until-condition |
| 4 | **judge-panel** (M independent judges over the same artifact → ensemble) | recurrent in eval projects (3-judge ensemble; 4–6 reviewer personas) | DRIVER | same `task`, M children differing only in profile/persona, deterministic merge of verdicts | M× `spawn(same task, diff profile)`; merge over `Settled.verdict` — **must stay write-only (selector≠judge)** |
| 5 | **adversarial-verify** (implement → independent re-inspection that distrusts the claim) | **21% (37 workflows)** | DRIVER | implement → adversarial verifier ("do NOT trust it, read the actual code") | a 2-node `seq`: `spawn(implementer)` → `spawn(verifier, task=implementer.out)`; verifier's verdict gates |
| 6 | **research-sweep** (parallel Explore agents fetch sources → synthesize cited report) | thin; 103 Explore spawns across 1,557 sandbox sessions (~6% of sessions touch it) | DRIVER (thin) | fan-out doc/source fetchers, fan-in synthesis with citation discipline | a fanout (shape 2) whose children are `harness: null` (router/inline) Explore agents |

**LEAF-layer shapes** (an agent parallelizing *itself*, inside one `execute` — never our orchestration,
and — critically — **never counted by the conserved-budget pool**; see §2 and the threats table):
- **within-turn tool batching**: 2–10 parallel `Bash`/`Read` calls in one assistant turn. Thousands of
  Bash calls in a single session; ~20K across the sandbox corpus. This is the *overwhelmingly* dominant
  "parallelism" in the data, and it is **not recursion of our atom** — it is one leaf's internal scheduler.
- **worktree-isolated self-fanout**: a leaf spawns its *own* sub-agents into git worktrees with
  non-overlapping file ownership (23/117 agents in one harness). This is the coding harness
  self-parallelizing — the "opaque, self-parallelizing leaf" the atom treats as a black box.

**Taxonomy verdict.** Six driver shapes, all expressible as `spawn`/`next` + a coded policy. None needs a
bespoke executor or a new control type. The single most common shape (driver-pipeline, 77%) is the
degenerate case: `spawn` one child, `await next()`, feed its `out` forward. The atom's "Plane B contains
Plane A" claim generalizes: **Plane B contains all six observed shapes** — each is a different `act` body
over the same `Scope`. The honest qualifier the rest of this doc carries: *expressing the shapes was never
in doubt; the shapes that stress the keystone's distinctive features (async widening, heterogeneous
per-child budgets) are the rarest ones in the corpus.*

---

## 2. Driver vs leaf in the wild — the recursive-atom claim, tested

The atom's load-bearing claim is `driver = leaf = one Agent` (`supervise/types.ts:1-50`, `Agent` at
`types.ts:47`): a leaf is an `Agent` that never calls `scope.spawn`; a driver is an `Agent` whose `act`
spawns and reacts. The corpus contains **two distinct phenomena** that the synthesis must not conflate —
only one of them supports the claim, and the other is the source of the threat-to-validity in the BLUF.

### (i) Role-flip at the orchestration layer — *genuinely supports* `driver = leaf = one Agent`

The same control thread is a leaf in one phase and a driver in another, with no type change:

- **Codex audit → fanout → patch is one agent flipping roles.** The main agent runs an Explore pass
  (leaf: reads files, no spawn), *then* becomes a driver (spawns named sub-agents with pinned briefs),
  *then* drops back to leaf to apply the merged patch. One control thread, three role-phases — an `act`
  that spawns in its middle and not at its ends.
- **Depth-2 driving exists but is rare.** A "synthesis lead" spawns N audit agents; several of those
  *themselves* spawn 2–3 Explore sub-agents. That is `Supervisor.run(root)` where `root.act` spawns
  children whose `act` spawns grandchildren, bounded by the pool and `maxDepth` (`defaultMaxDepth = 4`,
  `supervisor.ts:54-56`). **Observed depth ≤ 2; Codex caps at depth 1.** So `maxDepth=4` is *not* the
  binding constraint today — the conserved budget pool is. This matches the design's R3 note: depth
  ceiling is the weaker guard; the pool is the real bound on runaway recursion.

This (i) family **is** the empirical validation: the difference between a driver and a leaf is purely
whether `act` calls `scope.spawn`. No evidence demands a separate `Driver`, `Leaf`, or `Analyst` type — an
analyst is just an `Agent` whose `task` is "traces → findings" and whose `harness` is `null` (router/inline)
or `cli` (Halo).

### (ii) A leaf parallelizing *itself* — does NOT support the claim, and confounds the gate

This is a different thing, and the architectural distinction is the most important finding in this section.
A leaf's *own* internal parallelism (within-turn Bash/Read batching; worktree self-fanout) has its own
budget, its own scheduler, and is **not reducible to `scope.spawn` over our `Scope`.** The atom correctly
declares it opaque (`Executor.execute` → `resultArtifact()`, `types.ts:68-92`) — but opacity cuts both
ways:

- It is **not** evidence that *our* recursion is what happens in the wild. It is evidence that a **second,
  uncontrolled parallelism layer exists below our atom.** You cannot cite leaf-self-fanout both as
  "opaque, outside our Scope" and as "proof the recursive atom is what's running." It is the former.
- **It breaks the conserved-budget invariant.** The keystone's whole validity claim is `Σk(treatment) ≡
  Σk(blind)` enforced by the pool. If a `sandbox` leaf internally spawns 5 worktree sub-agents, that is 5×
  compute the pool **never reserved and cannot observe.** The equal-k gate the entire project rests on is
  therefore confounded by exactly the behavior the corpus shows is common at the leaf. This is logged as a
  first-class threat to validity (see the threats table in §5), not waved off as "opaque by design."

### Verdict

The recursive-atom claim **holds on the (i) evidence** — one `Agent` type is observably driver and leaf;
no separate types are warranted. The (ii) evidence is *not* support for the claim; it is a measured
confound on the gate. State both. The recursion that does exist is shallow (≤ 2); the deep parallelism that
does exist is opaque and uncounted.

---

## 3. Are the atoms enough? — each user story decomposed

The semantic atoms, named against the shipped surface:
- **sandbox / agent-profile** → `AgentSpec { profile, harness }` + the `sandbox` `Executor` (`types.ts:130`, `runtime.ts`).
- **agent-profile (router/inline)** → `AgentSpec { harness: null }` → direct Router call, no box.
- **loop + resume** → `Scope.next()` cursor + `SpawnJournal`/`ResultBlobStore` replay (`types.ts:343-358`).
- **fanout** → N× `scope.spawn` (`SpawnOpts`, `types.ts:205`).
- **parallelize (leaf)** → opaque inside `Executor.execute` — *and uncounted by the pool* (§2).
- **check** → `Settled.verdict` (`DefaultVerdict`) + the driver's selection over it (single-sourced via `settledToIteration`, `scope.ts`).
- **fork** → PR #150 `lineage` passthrough forwarded by the `sandbox` executor — leaf-level continue/fork, not reinvented here.

Legend: ✅ atom present · ⚠️ present but needs a thin convenience that is **not yet built** · ❌ missing seam (flagged).

### Story 1 — RSI / software architecture (this project)
*research SOTA → looped research over docs → plan/architecture → code → test; return 100% done or blockers fully defined.*

| Step | Atom | Status |
|------|------|--------|
| research SOTA | `research-sweep`: fanout of `harness: null` Explore agents → synthesize | ⚠️ needs G4 helper (unbuilt) |
| looped research over docs | `loop-until`: `while(budget) { spawn(reader); await next(); decide }` | ✅ |
| plan/architecture | one `spawn(planner)`; its `out` is the plan artifact (blob via `outRef`) | ✅ |
| code | `spawn(coder, harness: <sandbox>)` — composes `runLoop` | ✅ |
| test | `Settled.verdict` from the coder's own gate; or `adversarial-verify` (spawn verifier on coder's `out`) | ✅ |
| async, observable streaming root | spawn-on-completion widening `act` over `Scope.next()` | ⚠️ needs G5 reference `act` (unbuilt) |
| "100% done or blockers defined" | typed `SupervisedResult`: `winner` OR `no-winner{ reason }` (`types.ts:392-403`) — a no-winner is **never** coerced to best-effort | ✅ |

**Story 1 is expressible on the shipped atoms, pending G4 + G5 — both unbuilt.** The flat-harness `act`
plus a research prefix covers the spine; the research-sweep convenience and the async-streaming widening
driver are not yet written. Honest claim: *covered in principle by the shipped atoms, not "works today."*

### Story 2 — Mobile app + voice-AI platform
*deep research → scrape internet → clean → label → train models → embed back in app → build+ship tested app; voice: research SOTA TTS, collect data, learn cross-language eval, test.*

| Step | Atom | Status |
|------|------|--------|
| deep research, scrape | `research-sweep` fanout | ⚠️ G4 |
| clean / label data | a `spawn(cleaner)` / `spawn(labeler)` per shard — fanout over data partitions | ✅ (as compute) |
| **persist the dataset** | — | ❌ **no write-sink**: `ResultBlobStore` is content-addressed per-`outRef`, scoped to *one* run's replay (`types.ts:352`). No cross-run dataset/corpus the next run reads. Cleaned/labeled data dies with the run. |
| train models | `spawn(trainer, harness: <sandbox or cli>)`; long job → `budgetExempt` cli or deadline budget | ✅ (mechanism); cost-metering of a multi-hour train is `deadlineMs` only |
| eval TTS quality cross-language | `judge-panel`: M language-specific judge profiles over the same audio artifact | ✅ |
| build + ship tested app | coder leaf + `verify`/`adversarial-verify` | ✅ |

**Gaps:** the **data-collect/label/train** shape needs a **durable `Corpus` write-sink distinct from the
per-run blob store** (so run N+1 trains on run N's labels). **Story 2 is not expressible without G2.**

### Story 3 — Writing
*comb the user's own Codex/Claude sessions → write a daily post → evaluate/rate across dimensions → improve.*

| Step | Atom | Status |
|------|------|--------|
| comb own sessions for signal | `spawn(miner, harness: null)` over session files (this is exactly what produced THIS corpus) | ✅ |
| write the post | `spawn(writer)` | ✅ |
| evaluate across dimensions | `judge-panel`: one judge profile per dimension (voice / accuracy / anti-slop) → multi-axis `verdict` | ✅ |
| **improve over days (compounding)** | — | ❌ **no cross-run memory**: "improve" means today's post learns from yesterday's ratings. No place to read prior verdicts/findings into the next run. Same gap as Story 2's corpus, on the *findings* side. |
| daily cadence | — | ⚠️ **no scheduler**: nothing triggers "run daily." A thin external cron (the `schedule`/`loop` skills) calls `Supervisor.run` — acceptable out-of-band, but named. |

**Gaps:** cross-run **findings memory** (the `Corpus`, findings side) and an external **cadence trigger**
(out-of-band, not a new atom). **Compounding improvement is not expressible without G2.**

### Story 4 — Small-business automation agents
*build a tool (CODING loop), research (RESEARCH loop), write (WRITING loop); learn from business feedback (social/sales/leads/conversions) → emergent improvement.*

| Step | Atom | Status |
|------|------|--------|
| build a tool | a coding sub-loop = `spawn(driver)` whose `act` spawns coders — depth-2 driving | ✅ |
| research / write | story-1 / story-3 sub-loops, spawned as children | ⚠️ inherits G2/G4 |
| **ingest business feedback (sales/leads/conversions)** | — | ❌ **no external-signal ingress**: the only signal a driver branches on is `Settled.verdict` from its own children. Real-world metrics arrive *out of band, later, async*. The atom has no `Settled` source that isn't a child it spawned. |
| emergent improvement | requires feedback → corpus → next-run steer | ❌ (depends on the two above) |

**Gaps:** the **outer flywheel** the project has deliberately deferred (`CLAUDE.md`: "the outer flywheel…
waits for a *positive* gate result"). Story 4 needs (a) a `Corpus` write/read and (b) injection of
**external, non-child signal** as findings the next run's driver reads — the *same* missing seam: a
findings/corpus channel that outlives one `Supervisor.run`. **Story 4 is not expressible without G2.**

### Story 5 — Product fleet (tax/legal/creative/GTM/insurance) for non-technical owners
*personify the RSI per owner → build a world-model of their business → predict + solve every problem.*

| Step | Atom | Status |
|------|------|--------|
| personify per owner | a per-owner `AgentProfile` (system prompt + tools + persona) as the root agent's profile | ✅ (see §4) |
| build a world-model | `spawn(intake/recon)` agents mapping the business | ✅ as compute; ❌ as **persistent state** (the world-model must survive across sessions — corpus gap again) |
| predict + solve problems | fanout of solver sub-loops; `judge-panel` to score solutions | ✅ |
| per-owner isolation | one `Supervisor.run` per owner, distinct `runId`/journal root (`supervisor.ts:74`) | ✅ |

**Gap:** the **world-model is durable state**, not a per-run artifact, plus a **read-back** of that state
into the root agent's context at the start of each run. **Story 5 is not expressible without G2.**

### The single recurring gap, stated once
Four of five stories converge on **one** missing seam, not four. Today `ResultBlobStore` + `SpawnJournal`
are **per-run, for replay** (`types.ts:343-358`). What every non-trivial story needs is a **cross-run
`Corpus`**: a write-sink the leaves emit into (datasets, labels, ratings, world-model facts, external
signals) and a read-source the next run's root `act` consults. The keystone is *intentionally* missing it
(mechanism-ahead-of-the-gate discipline). **Without it the system is a within-run orchestrator** — and the
repo's gate memory says within-run orchestration does not beat blind compute. The Corpus is the read side
of the learning flywheel; it is the actual fuel line, and it is a small interface, not a subsystem (§5).

One observed datum *for* the keystone the synthesis should harvest: Codex measure→diagnose→iterate loops
**persist state in `.evolve/` and resume across sessions** — a single logical loop spanning sessions. That
is direct evidence that the event-sourced `SpawnJournal`/resume design (`types.ts:343-358`, PR #150 lineage)
is load-bearing, and a hint that the Corpus and the journal should share a storage spine even though they
stay distinct interfaces (journal = decisions, small; corpus = accreted facts, durable).

---

## 4. Persona / strategy / policy — the open question

**Drew's open question:** is persona/strategy/policy just `AgentProfile` config, or does it need a
first-class `Policy`/`Persona` type distinct from the profile?

### What the evidence shows persona/policy actually IS
The mined persona signals split cleanly into **three kinds**, living in three different places:

1. **Identity / voice / expertise** — "senior alignment researcher", "adversarial verifier — do NOT trust
   it", "senior trust-and-safety reviewer", the named Codex personas. **This is a system prompt + model +
   tools.** It maps 1:1 onto `AgentProfile.prompt.systemPrompt` + `model` + `tools` (the shipped sandbox
   SDK profile shape: `prompt`, `model`, `tools`, `mcp`, `subagents`, `permissions`).

2. **Hard rules / guardrails** — "no silent fallbacks", "cite file:line", "no-fabrication", a forbidden-
   token list, "extend-don't-fork is law". **Partly prompt, partly enforced structurally.** The forbidden-
   token rule was enforced by a *grep-verify* step (a `check`), not the prompt — i.e. some policy is a
   **verifier**, not a persona string.

3. **Strategy / orchestration shape** — "audit 5 products → 5-parallel then merge", "implement →
   adversarial verify", "always run a random@k control", widening-vs-flat. **This is not persona at all —
   it is the `act` body** (which §1 shape the driver runs) plus the `WidenGate` (`types.ts:437`).

### Recommendation: NO new first-class `Policy`/`Persona` type. Three existing seams carry it.

The cleanest definition reuses what exists and invents nothing — type sketch:

```ts
// persona = profile (the sandbox SDK type, verbatim — verified shape)
type Persona = AgentProfile          // { prompt: { systemPrompt; instructions?: string[] }, model, tools, mcp, subagents, permissions, resources: { instructions?: string | AgentProfileResourceRef } }

// strategy = the act body + per-child budgets (no type)
type Strategy<Task, Out> = Agent<Task, Out>['act']   // which §1 shape; budgets via SpawnOpts.budget (types.ts:205)
//            + WidenGate<Out>                          // the one parameterized strategy knob (types.ts:437)

// policy = data on the profile (soft) OR a check (hard) — no type
//   soft:  profile.prompt.instructions[]  |  profile.resources.instructions   (both exist in the SDK)
//   hard:  an Agent<_, Out> whose verdict gates  (= the adversarial-verify child, or a structural invariant)
```

- **Persona = `AgentProfile`.** Verbatim. To "act like Drew or any owner" is to supply that owner's profile
  as the **root agent's profile**. A first-class `Persona` type would duplicate `AgentProfile` — reject it.
  Compose per-owner profiles with the SDK's own `mergeAgentProfiles` / `defineAgentProfile` (no bespoke
  composition layer needed).
- **Strategy = the `act` body + `SpawnOpts.budget`** (the "driver A for n shots, B for k shots"
  requirement, `types.ts:205`) + the `WidenGate` (the only *parameterized* knob, and it already exists). No
  `Strategy` type.
- **Policy = two channels by enforcement kind:** *persuadable* rules → `prompt.instructions[]` /
  `resources.instructions` (data, not type); *enforceable* rules → a **`check`**: the leaf's own `verdict`,
  a spawned `adversarial-verify` child, or a structural invariant the keystone already enforces (the pool
  enforces equal-k; the firewall enforces selector≠judge). Policy that must be *true*, not *encouraged*, is
  a verifier — and verifiers are just `Agent`s with a `verdict`.

**The one real crack — be honest about it.** Story 5's per-owner *durable* persona+world-model needs the
profile to be **stateful across runs**. But `resources.instructions` is `string | AgentProfileResourceRef`
— a **static pointer**, not an accreting store. "Read yesterday's world-model into the profile" therefore
requires **the `Corpus` (G2) *plus* a profile-composition step that renders accreted facts to a string each
run.** So the precise statement is: persona is **not "just `AgentProfile`" for Story 5 — it is `AgentProfile`
*as a projection of* the Corpus.** The **type** claim is correct (no new `Policy`/`Persona` type); the
**sufficiency** claim is not — stories 4 and 5 cannot be expressed without G2.

**Net:** persona = profile; strategy = `act` + budgets; policy = instructions (soft) or a `check` (hard).
**Do not add a `Policy`/`Persona` type — it would duplicate `AgentProfile`.** But do not let "no new type"
launder into "covered with zero machinery": the atom is sufficient for "act like Drew" **only once the
`Corpus` read-back (G2) exists.**

---

## 5. Architecture gaps + the short next-phase list

What the keystone (shipped) still needs to serve **all five** stories. Each is a small, named seam,
consistent with the no-mechanism-ahead-of-the-gate discipline.

### The single most important gap (state it before the table)
**The cross-run `Corpus` (G2) is the bottleneck, not orchestration.** Four of five stories need it; it is
the read side of the learning flywheel, which is the entire thesis of the repo. Everything in the table
below that is not G2 is polishing an engine whose fuel tank is not yet connected. The discipline says
*design* G2 now and *build* it on a positive gate — but the ranking must reflect that **without G2 there is
no RSI, only a fancier within-run orchestrator**, and the within-run orchestrator already shows ~0
coding-headroom and steering-loses-at-equal-compute in this repo's own measurements.

| # | Gap | Why (which stories) | Minimal seam | Gate status |
|---|-----|---------------------|--------------|-------------|
| G1 | **Port the analyst→driver `analyses` seam from the round-synchronous driver onto the reactive `Scope`** | all (traces→findings→steer is the RSI premise) | `analyses` is **already wired and firewalled** in the round-synchronous `createDriver`: the `analyze` hook is called (`drivers/dynamic.ts:174-176`), findings are passed via `PlannerContext.analyses` (`drivers/sandbox-planner.ts:222-224`), and the selector≠judge firewall fires (`assertTraceDerivedFindings`, `drivers/dynamic.ts:311`). The gap is that **the new `Supervisor`/`Scope` keystone has no analyst channel at all** — `analyses` appears in `supervise/types.ts` only inside a doc-comment (`types.ts:434`). G1 = **carry the existing firewalled seam across the round-synchronous → reactive-Scope boundary** so a driver's `act` can read analyst findings (not raw child `verdict`s) off the `Scope`. This is a **port, not a first wiring.** No new type — an analyst is already an `Agent`. | port now (the seam exists and is proven in the old driver; only the Scope crossing is missing) |
| G2 | **No cross-run `Corpus`** (datasets, labels, ratings, world-model, external signals) | 2, 3, 4, 5 — and the *only* stories needing new machinery | `ResultBlobStore`/`SpawnJournal` are per-run, for replay (`types.ts:343-358`). Add a **separate durable `Corpus`** (`append(record)`, `query(filter)`) — NOT folded into the journal (journal stays small: decisions). Leaves emit into it; the next run's root `act` reads it into `AgentProfile.resources.instructions` via a render step. This is the learning-flywheel read side. | **after a positive gate** (explicitly deferred by `CLAUDE.md`); **design the interface now**, build on green |
| G3 | **No external-signal ingress** (a `Settled` that isn't a child you spawned) | 4 (business feedback), 5 (real-world outcomes) | Real-world metrics arrive async, later. Model them as **`Corpus` records written out-of-band**, read by the next run — G3 is a *consumer* of G2, not a new mechanism. The atom does NOT need inbound async events into a *running* `act`; defer until a real source exists. | after G2 |
| G4 | **`research-sweep` / periodic cadence is unhoused** | 1, 2, 3 (daily writing) | research-sweep is just a fanout of `harness:null` children — already expressible; ship a **`researchSweep(sources)` helper `act`** as a convenience, not a primitive. Cadence stays **out-of-band**: the `schedule`/`loop` skills call `Supervisor.run`. Do not add a scheduler to the runtime. | helper now; scheduler never (out-of-band) |
| G5 | **Round-synchronous planner, not async-streaming** | 1, 4, 5 (long, heterogeneous sub-loops) | `createDriver` plans → runs a batch → observes all → re-plans. The `Scope` already supports `next()` on *individual* completions, so the async-streaming driver is *writable today* — what's missing is an example `act` that does spawn-on-completion widening. Ship one reference widening `act` (with `WidenGate` defaulting to flat). | now (an `act` over the shipped Scope; no keystone change) |

### The short list (do these, in order)
1. **G1 — port the existing firewalled `analyses` seam onto the reactive `Scope`.** It is wired in the old
   round-synchronous driver; carry it across the Scope boundary, keeping selector≠judge. This is the RSI
   spine and is *not* premature — but it is a port, not a green-field wiring.
2. **G5 — ship one async-streaming widening `act`** as the reference driver (flat `WidenGate` default).
   Pure `act`-over-Scope; validates the dynamic shape — i.e. the ~0.5% shape the keystone exists for.
3. **G2 — design the `Corpus` interface now, build on a positive gate.** The single seam four of five
   stories need; the actual fuel line of the flywheel. Honor the discipline: design, don't build, until the
   diverse@k-vs-blind@k gate is green.
4. **G4 — `researchSweep` helper `act`.** Cheap, unblocks stories 1–3; cadence stays external.
5. **G3 — defer** until G2 exists and a real external-signal source is named.

### Threats to validity (drawn from the corpus, not hypothetical)
| Threat | Evidence | Effect on the gate |
|--------|----------|--------------------|
| **Leaf-internal self-fanout is compute the conserved pool cannot reserve** | worktree sub-agents (23/117 agents in one harness); 2–10 within-turn Bash/Read per turn, ~20K Bash across the sandbox corpus | The pool enforces `Σk(treatment) ≡ Σk(blind)` only over *spawned children*. A leaf that internally fans out N× inflates real `k` invisibly. **The equal-k gate is confounded** unless leaf-internal fanout is either bounded, metered into `UsageEvent`, or held constant across arms. Resolve before any beat-blind claim. |
| **Observed recursion is shallow (≤ 2; Codex depth 1)** | §1/§2 counts | The keystone's deep-recursion features (`maxDepth=4`, async widening) are untested by real demand; their value is a bet, not a measured need. |
| **The distinctive shape is ~0.5% of workflows** | §1 frequency column | Optimizing the keystone for async/heterogeneous-budget recursion serves the tail; the 77% pipeline case needs almost none of it. |

### What NOT to build
A `Policy`/`Persona` type (§4 — duplicates `AgentProfile`); a `Driver`/`Leaf`/`Analyst` type split (§2 —
one `Agent` suffices); a learned/LLM meta-controller beyond the one opt-in meta-driver already sanctioned; a
runtime scheduler (out-of-band); a Temporal/DBOS backend (the JSONL `SpawnJournal` is the v1 event source);
an inbound async event bus into a running `act` (G3 is a corpus consumer); and a bespoke profile-composition
layer (use the SDK's `mergeAgentProfiles`).

**Bottom line.** The atoms are enough to *express* the orchestration — six observed shapes, one `Agent`
type, the driver=leaf role-flip confirmed in the wild. **The orchestration is not the bottleneck.** The
bottleneck is **cross-run memory (G2, deferred by discipline) plus a clean equal-k gate that is currently
confounded by opaque leaf-internal fanout.** Persona/strategy/policy need **no new type** — they are
`AgentProfile` + the `act` body + a `check` — but stories 4 and 5 are not *expressible* until the `Corpus`
read-back exists. Port the analyst wire (G1) and ship the reference widening `act` (G5) now; design G2;
fix the leaf-fanout confound before claiming a beat-blind result; everything else is out-of-band or gated.
