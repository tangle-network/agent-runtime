> **Track:** Architecture (research) · **Role:** deferred-learner spec — the belief-state / program-synthesis layer · **Status:** BUILD-ON-GREEN (gated on a positive diverse@k-vs-blind gate)

<!-- Source: workflow w1x80539n — theory + subtractive-architecture + data-science + red-team lenses -> adversarial synthesis -> reconcile. Stress-tests + expands the "belief-state agents" draft against the shipped substrate (src/loops/supervise, src/durable/spawn-journal.ts, src/loops/personify, bench/, docs/research/*). The learner waits on the gate; this is its blueprint, not a build order. Cross-links: recursive-execution-atom.md, architecture-alternatives.md, observed-orchestration-patterns.md. -->

# One Recursive Agent over a Belief-State of Programs — Design Spec

*Reconciles the critique. Every grounded slip is fixed and marked **[FIX-n]**. The central correction: there is no single "Corpus" — the gate's measurement plane and the flywheel's claim plane are distinct stores; the four-scalar collapse argument is rebuilt on the one record that actually carries `confidence`.*

## 1. The Unifying Formalism

The controller is **one recursive atom** `Agent<Task,Out>{ act(task, scope) }` (`supervise/types.ts:47`): `act` either *spawns* children into a `Scope<Out>` (driver) or *returns* a typed `Out` (leaf), supervised by a conserved-budget tree with deterministic replay. Its **minimal sufficient statistic** is not a learned posterior — it is the triple the substrate already materializes: `(budget-pool feasibility, journaled settlements, trace-derived findings)` — *did-we-afford-it* (`BudgetPool`, invariant `total ≡ free + reserved + committed`, `budget.ts:9`), *what-settled in seq order* (`SpawnJournal` + `ResultBlobStore`), *did-a-distrusting-reader-find-a-concrete-defect* (`AnalystFinding` behind `assertTraceDerivedFindings`, `analyst.ts:47`). **Generalization has two sources, neither within-run belief:** (a) the conserved pool makes equal-k a *construction*, not a measurement artifact; (b) the diversity of programs tried plus the cross-run claim corpus (`personify`, the G2 read side) accreted over 50+ runs. **Belief tracking earns its keep only when a domain has a cheap deployable verifier producing a calibratable pass/fail/defect signal** (program synthesis; §4) — and only AFTER the running gate shows any non-blind signal beats blind random@k at equal k. On the measured world (finsearch: deployable selector **−8.2pp**, n=51; coding driver headroom **0.0pp**), the factorized-posterior belief machine is **mechanism ahead of the gate** and ships nothing.

**Verdict on the belief draft:** the 5-store Σ is *correct in principle, structurally redundant in practice* — each store maps onto a shipped seam, and its three independently-calibrated scalars collapse because the system rules the judge **write-only** (selector≠judge). Keep the *vocabulary*; reject the *new machinery*.

## 2. The Minimal Primitive Set (the subtractive win)

**[FIX-1, FIX-2] There are FOUR durable stores, not the "two" the prior draft claimed — and they serve two unrelated planes.** Naming them precisely is the load-bearing correction:

| Store | File / schema | Plane | Carries `confidence`? |
|---|---|---|---|
| **SpawnJournal** | `spawn-journal.ts`, thin `SpawnEvent{ids,budget,seq,outRef}` | per-run decisions/replay | no |
| **ResultBlobStore** | `spawn-journal.ts`, content-addressed (`contentAddress():48`) | per-run payloads | no |
| **Claim corpus** (flywheel) | `personify` `CorpusRecord` `wave-types.ts:387` `{schemaVersion,id,runId,producedAt,area,claim,rationale?,tags,confidence,evidence?}` | cross-run accreted claims (G2 read side) | **yes** |
| **Rollout-cell corpus** (gate) | `bench/src/corpus.ts` `{runId,experimentId,candidateId,seed,model,promptHash,configHash,commitSha,wallMs,costUsd,tokenUsage,outcome{searchScore\|holdoutScore},splitTag}` | per-attempt equal-k measurement (`pnpm gate` over `corpus/finsearch.jsonl`, n=51) | **no** — has `outcome.score`/`splitTag` |

The −8.2pp gate result is read from the **rollout-cell** store; the flywheel reads the **claim** store. They have disjoint schemas and purposes; collapsing them is over-minimization that erases the gate's own evidence plane.

**Deleted / unified (what the lenses agree to cut):**

| Draft construct | Verdict | Collapses to |
|---|---|---|
| evidence-graph 𝓔 vs belief-graph 𝓑 vs log 𝓛 (3 stores) | **unify → 2 spines** | `SpawnJournal` (settlements+seq) + claim corpus (cross-run claims). Evidence *is* the `Settled` offspring; belief *is* the trace-derived `AnalystFinding`. |
| 4 scalars (posterior, extractor-conf, source-trust, approval) | **unify → 1** | the **claim-corpus** `confidence:[0,1]` (`wave-types.ts:387`, validated finite/in-range, fail-loud `corpus.ts:59`), minted by the caller as `score ?? (valid?1:0)`. Source-trust + approval are *operator discipline* (firewall, selector≠judge), not record fields. **[FIX-1]** the rollout-cell store has **no** `confidence` and is excluded from this collapse — its scalar is `outcome.score`. |
| memory-views 𝓜 (4 views + promote/decay/revoke) | **unify → 2** | transient = `Scope` nursery (live children, `scope.next()` cursor); persistent = claim corpus (gated `renderCorpusToInstructions`, `corpus.ts:130`). Procedural memory stays *fixed* until the gate is green. |
| action taxonomy (epistemic/computational/effectful) | **unify → 1** | every spawn is one `Agent.act` through the keystone; gating lives in the driver's `until` + `WidenGate`, not type variants. Effectfulness is a `Persona`/profile concern. |
| factorized posterior over typed latent vars | **defer** | needs the decomposition known in advance; the binding question is whether *any* signal beats blind, not whether it is decomposed. |
| `Persona` as a new type | **already deleted** | `Persona = AgentProfile` (`personify/persona.ts`). |
| four-scalar ledger shipped NOW (data-lens proposal) | **[FIX-3] DISOWNED** | three of the four scalars have **no producer** (the doc admits there is no calibrated `trace→confidence` map); shipping them as required fields is a fake-fallback / fail-loud violation. This is a **G-STEAL-7** schema, gated — not build-now. |
| in-memory journal | **[FIX-6] KEEP** | `InMemorySpawnJournal` (`spawn-journal.ts:139`) is the *default* `SupervisorOpts.journal` (`types.ts:374`) — the ephemeral impl behind the same interface, not a competing source of truth. Deleting it breaks every non-durable test. The real point: only the *durable* journal is load-bearing **for replay**. |

**Final closed type surface (orthogonal, all but one SHIPPED):**

1. `Agent<Task,Out>{ act(task,scope) }` — the recursive atom. **SHIPPED** `types.ts:47`.
2. `Scope<Out>` — conserved-budget nursery: `spawn` (atomic reserve, fail-closed), `next()` (ray.wait seq-cursor), `view`. **SHIPPED** `types.ts:261`.
3. `Supervisor`/`SupervisedResult<Out>`/`RootHandle<Out>` — typed result (`winner | no-winner`, never coerced), abort cascade, live view. **SHIPPED** `types.ts:364`.
4. `LeafExecutor<Out>` — the **OPEN** leaf runtime (`router|sandbox|cli|BYO`), admitting a **non-LLM executor** — the synthesizer plugs in here with zero core change. **SHIPPED** `types.ts:68`, registry `:143–171`.
5. `SpawnJournal` + `ResultBlobStore` — content-addressed (`contentAddress():48`), `replaySpawnTree` sorts by `seq` (`:299`). **SHIPPED.**
6. `Outcome<D> = {done|blocked}` + `personify` combinators (`pipeline/fanout/loopUntil/panel/verify/widen`, `combinators.ts`). **SHIPPED** `personify/types.ts:51`. **[FIX-6, minor]** Note the redundancy the red-team flags: `SupervisedResult<Out>` already carries a typed terminal; `Outcome<D>` is a *second* done/blocked discriminant. Retained — it is the leaf-author's contract (the shape every combinator synthesizes into), and is carried unchanged as `SupervisedResult<Outcome<D>>` — but if a future shape needs no progress/blocked distinction, this is the first wrapper to delete.
7. Claim corpus + `assertTraceDerivedFindings` firewall. **SHIPPED** `wave-types.ts:387`, `analyst.ts:47`.

**Net-new code, all small + orthogonal:** (a) **one** `EvidenceAtom{ kind, uri, provenance, polarity, confidence }` to stop six implicit per-layer mappings (span/event/artifact/metric/judge/finding) — tangle `AnalystFinding` in at the boundary, don't fork it; (b) **one** refuter `AgentProfile` (§4/§5); (c) gated-only: the calibration extractor + QD insertion policy.

## 3. Data: get / represent / store / quality + the memory set

**GET.** Evidence originates at exactly three already-emitted points: leaf settlement (`Settled{out,verdict,spent,seq}`), the verdict channel (`DefaultVerdict{valid,score}`), and the firewalled analyst pass (`trace → AnalystFinding`, provenance-checked). **Sampling discipline:** blind random@k at equal *rolled-up* spend (`TrajectoryNode` + `equalKOnCost`, `wave-types.ts`); exclude infra-errored cells; report the discordant count. **Test-retest invariance is the entry ticket** for a gate domain — aec-bench's `verify.py` is test-retest=0 (deterministic, graded partial credit, no Docker/no LLM, `HARNESS.md:77`); finsearch's LLM judge passed 0-flip retest before use.

**REPRESENT.** Canonical schemas, content-addressed where reproducibility matters:
- `SpawnEvent` — *thin* (ids, budget, `seq`, `outRef`); the payload lives in the blob store keyed by `contentAddress()`. This decision/payload split is why replay is blob-latency-independent.
- **Claim-corpus `CorpusRecord`** (`wave-types.ts:387`) — **one** `confidence:[0,1]` (validated finite/in-range, fail-loud `corpus.ts:59`). Do *not* triple-bucket; the four-scalar split is a deferred inference-engine concern, not a runtime record field.
- **Rollout-cell `CorpusRecord`** (`bench/src/corpus.ts`) — the equal-k measurement record; scalar is `outcome.score`, partitioned by `splitTag` (search/holdout). **Separate store, separate plane.** **[FIX-2]**
- `EvidenceAtom` — the single unifying boundary type, explicit `polarity` (pass/fail/defect) + `provenance`.

**STORE.** Two append-only JSONL claim/decision spines (journal, claim corpus) sharing the same stable-stringify + idempotent-dedup pattern (a malformed record throws — silent acceptance of garbage is the failure mode, `corpus.ts:15`); one content-addressed blob store; one rollout-cell JSONL (`corpus/finsearch.jsonl`, `appendRunRecord` `bench/src/corpus.ts:251`) as the gate's data plane. Every record carries **both** wall-clock `producedAt` and deterministic `seq` so post-hoc queries never reverse-engineer cursor order from timestamps.

**QUALITY / the calibration crux.** The unsolved gap, stated honestly: there is **no mechanism mapping trace-evidence → calibrated `confidence`**. H1–H5 are validated only on a *synthetic simulator with known latent causes*; the real domain has no known-latent assumption and `confidence` reads straight off the verdict. **A learned `(trace,verdict) → confidence` extractor is the single thing that would let belief beat blind — and it is gated**, because it costs compute and is justified only once a non-blind signal is shown to exist.

**[NEW — data-quality holes the prior draft under-weighted]:**
- **Independence (effective-n).** The claim corpus dedups by `id = hash(claim+tags)` (`wave-types.ts:389`), so two runs phrasing the same fact differently both persist and both render — correlated evidence inflates effective-n. **The "survived ≥N runs" promotion gate is INVALID unless those N are independent.** Promotion must cluster near-duplicate claims (semantic, not hash) and count *clusters*, not records, before applying the paired-bootstrap+BH bar.
- **Provenance must be required, not optional.** `CorpusRecord.evidence` is `evidence?` (`wave-types.ts:387`), so a claim can render above `minConfidence` with zero traceback. For a corpus that gates selection, optional provenance is a **fail-open**. **Make `evidence` required for any record that renders into instructions** (`renderCorpusToInstructions`); a claim with no checkable provenance is not promotable.

**Which memories to generate + the promotion policy.** Generate exactly two tiers; promotion is a *statistical decision*, not a heuristic:
- **transient (working/episodic):** the live `Scope` tree — never persisted beyond the run.
- **persistent (semantic):** claim-corpus records, promoted into a render *only* above `filter.minConfidence` (`corpus.ts:130`), ranked by confidence, **with required provenance and cluster-deduped independent support**. Promotion gate = "claim cluster survived ≥N *independent* runs and a refuter" — the same paired-bootstrap+BH bar as the main gate, applied to the claim.
- **procedural (the agent rewriting its own topology):** **NOT generated** until the gate is green (`G-STEAL-6`).

## 4. Program-Synthesis as the Payoff Regime

`act` *is* search over a hypothesis space of programs, and the synthesizer is the most powerful leaf precisely because `LeafExecutor` is **open and admits a non-LLM executor** (`types.ts:68`) — it plugs into the existing pool/journal/replay machinery with **zero** core change. Synthesis is the one regime where belief/QD/mechanism-growth **provably** pays, because it is the only regime that supplies a *total, cheap, deterministic verifier*: per the architecture-alternatives tie-break, you **REPLACE the tree only when a domain has a total cheap verifier** — synthesis is exactly that domain. With a total verifier: (i) `confidence` becomes *actually* calibratable (pass/fail is ground truth, not a judge's private opinion), dissolving the §3 crux; (ii) a QD-archive over program descriptors gets a real fitness signal to niche on; (iii) proof-gated mechanism growth can shadow-run the driver's own operator set against the verifier. **On-ramp:** `aec-bench` (deterministic `verify.py`, graded partial credit, **correctable middle band**, no Docker — the candidate gate bench) → `commit0`/`programbench` (official graded harness, Docker). The middle band is what makes a refuter/QD/belief signal *detectable*; coding's 0.0pp headroom is the absence of that band.

**π-spawns-act, human-as-root:** the root `Agent` is the human's intent; the tree is observable live via `RootHandle.view/signal/abort` (`types.ts:411`), so the viz/chat client consumes the same tree the kernel runs — supervision and observability are the same object, not a bolt-on.

## 5. Build Order vs the Gate

**[FIX-4, FIX-5] The one fork worth surfacing — refuter build-now vs gate-first — is real, not papered over.** Three lenses nominate the build-now refuter; the red-team lens dissents: run the bare gate first, then `G1 analyst-on-scope`, *then* design the refuter, on the ground that a build-now refuter is itself mechanism-ahead-of-gate. **Resolution:** they are sequenced, not exclusive — item 4 (the bare gate) and item 1 (the refuter) run **in parallel** because the refuter is the *cheapest deployable non-blind selector to put INTO that gate* (cost k→k+1, zero new store, zero new inference). The refuter is build-now **only** because it is evaluated *by* the gate, not shipped to selection ahead of it. If the firewall condition below cannot be met, the red-team ordering wins and the refuter waits.

**[FIX-4] The refuter firewall must be SEMANTIC, not syntactic.** `assertTraceDerivedFindings` (`analyst.ts:47`) only blocks `kind:'metric'` URIs matching `/^(verdict|judge|score)\b/i` — a refuter emitting `kind:'finding'` "candidate scored low on rubric X" passes by *renaming the channel*, smuggling the judge into selection with one indirection. **Therefore: the signal fed to the selector is not the refuter's verdict but the result of an INDEPENDENT re-check of the refuter's cited defect** — a `file:line` an executor re-runs, a failing assertion, a proof-step that fails to typecheck. If the cited defect is not independently checkable by a non-judge executor, it does not count. Ranking on *defect-survived-an-executor-recheck* is firewall-clean; ranking on the refuter's *opinion* is selector=judge and is rejected.

**Cheap, build-now (vocabulary + typing + reuse — zero new inference, zero new store):**
1. **G-STEAL-1 refuter** — ONE new `AgentProfile` spawned as a sibling in the existing `panel` combinator, rewarded only for localizing a concrete **independently-checkable** defect (file:line / failing assertion / proof-step); the selector ranks on *executor-rechecked-defect-survived*, never on the refuter's self-report. Firewall preserved per the semantic condition above. Runnable TODAY on the committed finsearch corpus, attacking the −8.2pp loss head-on. **Conditioned on the semantic firewall holding.**
2. **G1 analyst-on-scope PORT** — the round-sync driver's analyst, ported onto `Scope`, spawned as a child, behind `assertTraceDerivedFindings`. No new execution mode. *(The red-team lens's headline pick.)*
3. **`EvidenceAtom`** boundary type; `TrajectoryNode` + `equalKOnCost` wired into the gate; `Outcome<D>` typing; **require `evidence` + cluster-dedup on the claim corpus** (§3).
4. **Phase 0 / the bare gate, in parallel** — diverse@k vs blind random@k under a deployable selector at equal k, paired-bootstrap + BH. One command; unblocks every downstream routing decision.

**Gated on a positive result (the LEARNER tier — do NOT build until the gate is green):** QD-archive over the claim corpus (`G-STEAL-3`, a *query interface* over shipped journal+blobs, not a new store), epistemic-widen (`G-STEAL-4`), shadow-price admission (`G-STEAL-5`), open-pursuit `Outcome.progress` (`G-STEAL-2`), proof-gated mechanism growth (`G-STEAL-6`, shadows the held-out gate on the driver's own operators), the **calibration extractor**, and **[FIX-3]** the **four-scalar ledger** `{posterior, extractorConfidence, sourceTrust, approval}` (`G-STEAL-7` — explicitly NOT build-now; three fields have no producer until a calibrated extractor exists). The user's full belief-state inference engine (latent posterior, calibration, promote/decay/revoke) is the **`G-STEAL-7` shadow-run admitter** that **never ships to the runtime core** — it lives as a pluggable analyst under the same firewall, proven on a held-out corpus before it touches selection.

**The honest line:** the recursive atom, the conserved pool, the journal, the firewall, the *two named corpora*, and the open synthesizer leaf are *shipped and load-bearing*. The refuter (under the semantic firewall) and the gate are *cheap and run now*. **Everything that learns — belief inference, QD, mechanism growth, the four-scalar ledger — waits on the gate returning positive.** Mechanism is not evidence.

---

## Verdict

**Signal with one slop seam, now closed.** The belief-state expansion is **rock-solid as vocabulary and as the deferred-learner spec, partial slop as a build-now component** — its sharp edges (the 5-store Σ, the four independently-calibrated scalars, the four-scalar ledger "ship now") are precisely the parts that map to *no current producer* and would ship fail-open fields ahead of the gate; the critique correctly caught that the prior draft cited two different `CorpusRecord` types as one and unified the gate's own measurement plane out of existence. Stripped to what the substrate already materializes — conserved-budget tree, seq-ordered journal, the single claim-corpus `confidence`, the write-only judge — it is architecturally un-improvable and honestly gated. **The single highest-leverage next move that does NOT violate gate discipline: run the bare diverse@k-vs-blind-random@k gate at equal k on the committed finsearch rollout-cell corpus, and in the same harness evaluate the refuter as a candidate deployable selector — under the semantic firewall (selection consumes an executor's independent re-check of the cited defect, never the refuter's own verdict).** That one run either produces the first non-blind signal (unblocking the entire LEARNER tier) or confirms −8.2pp is structural (killing the belief machine for this domain) — and it spends k+1, not a new store, not a calibration engine, not a four-scalar ledger.
