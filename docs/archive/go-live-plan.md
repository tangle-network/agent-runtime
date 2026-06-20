> Track: Reference · Role: go-live plan · Status: proposed, post-2026-06-13 evidence reset (POWER-16 retracted the depth>breadth keystone).
> Generated via the intelligence-sdk-rederivation workflow (5 grounded lenses -> synthesis -> adversarial hardening), every load-bearing code claim verified.

All claims verified. Two corrections to the proposed plan (inbox-creds already merged as #271; egress-probe already exists) reduce the build cost and remove a blocker — both make the 2-week slice *more* real, not less. The `handleChatTurn` smoke-test target is real (`src/durable/chat-engine.ts`). E4 doc doesn't exist yet (it's the `e3-certified-memory.md` line's "NEXT", designed-not-launched per `current.json`). Here is the hardened final plan.

---

# GO-LIVE PLAN — Tangle Intelligence SDK (hardened, post-2026-06-13 evidence reset)

**Adversarially reviewed against ground truth.** Two factual errors in the proposed plan were corrected (both reduce risk): the inbox-creds fix is **already merged** (PR #271, commit `49033aa`), not unpushed; and `bench/src/egress-probe.mts` **already exists**. The honesty firewall, the OFF-tier foot-gun, and the dead-keystone diagnosis all checked out against code and `.evolve/current.json`. The plan stands; the corrections sharpen the timeline.

## BLUF

Ship a **verifiably-smarter-and-cheaper** product. The vision is intact: make agents smarter, hold them smarter at lower cost, slot in with the fewest LOC, gate every change, and run real research on the same harness. The one correction POWER-16 forces is *where* "smarter" comes from and *how* it's claimed: **smarter comes from gated search (spend compute to find a better artifact, certify the winner), not from a within-run trick that beats blind at equal compute** — that specific mechanism is the tie POWER-16 retracted (+4.1pp CI[−1.6,+10.2] at n=72; the n=16 +16.4pp was an underpowered streak). Once found and certified, the better artifact is **cheap to serve** (retrieval-is-execution) and the cost flywheel holds quality at −12 to −31%. The gate is not a limit on "smarter" — it is the **moat**: everyone else sells improvement from lucky streaks; we sell *"smarter, with the held-out evidence that proves it isn't a streak at your n."* The 2-week slice — **Mode 0 (intelligence OFF / sandbox-stream) + Observe + the billing boundary** — runs over already-shipped substrate; the only new artifact is the ~200-LOC `src/intelligence/` wrapper plus usage classification (inference vs intelligence). Dogfood on **gtm.tangle.tools**, not Harvey. The single most dangerous move is letting "smarter" ship *without* its gate+CI+n attached; the release gate below makes that structurally impossible.

**Proven now vs proven next.** Proven: a gate-certified program transfers and lifts held-out score (+31.7/+36.7pp vs prose memory) at lower cost — a single smarter-and-cheaper *step*. Prove next (E4, the #1 experiment): that it **compounds** as the certified store grows. The honest claim today is the step; the flywheel is what we measure — the difference between "smarter once, cheaply" and "your agent compounds."

---

## 1. THE HONEST TAGLINE

**The customer claim the evidence backs:**
> **"Agents that get verifiably smarter and cheaper — proven on held-out evidence, not lucky streaks."**

"Verifiably" is the whole game: we *do* make agents smarter (via gated search + certification) and hold them cheaper (serve the certified artifact), and the held-out gate is what separates a real gain from a streak — the moat, not the disclaimer.

The two replicated survivors, with provenance:

| Survivor | Evidence | Run |
|---|---|---|
| Certification rigor predicts transfer | Only a full-statistical-gate-certified artifact transfers: holdout cert-vs-prose **+31.7pp CI[+13.3,+48.3]** and **+36.7pp CI[+11.7,+66.7]**, twice | E3d (5-run, agent-lab) |
| The cost flywheel | Certified memory + compression **HOLD quality at −12% to −31% cost**; steer+compress promoted ×2 on AIME; author lands near-parity at 30–55% cost, replicated ×3 | E3/E3b/E3d, cost-arc, powered run |

**Mandatory provenance rider on every public claim** (both survivors are measured on EOPS/AIME via the agent-lab harness, **not yet through `withTangleIntelligence` in a product**):
> *"Demonstrated on internal benchmarks; in-product replication in progress."*

---

## 2. THE DO-NOT-CLAIM LIST (the honesty firewall)

This is where "take risks" stops. Boldness is allowed in *speed, scope, and dogfooding*. The firewall is narrow and precise: **"smarter" is allowed — but only with its gate, CI, and n attached.** An unqualified or un-gated efficacy claim to a paying customer is forbidden. The line:

1. ✗ **"Our loop makes your agent smarter for free / by steering / without spending more compute."** The within-run-cleverness-beats-blind mechanism is the tie POWER-16 retracted; at equal compute, compute dominates. Smarter is real, but it comes from *gated search* (spend compute, certify the winner), not a free trick. ✓ ALLOWED: "we search for a better configuration and ship it only when it clears a held-out gate."
2. ✗ **a bare "+Npp" / "depth beats breadth" / any single-number quality lift with no CI and n** — the cautionary tale. ✓ ALLOWED: a lift *with* its paired-bootstrap CI and n, from a gate that resolved at that n.
3. ✗ **"Verified PRs improve your agent."** A passing-checks PR proves **non-regression on the customer's n**, not improvement. Rename to **"Gated PRs / Verified-Safe PRs."**
4. ✗ **"Self-improving / it learns and gets better over time"** — accumulation is unproven; in-stream admission is DEAD (E3c/E3d, winner's curse). Only *selection of one certified artifact* is real.
5. ✗ **"The flywheel compounds / cost keeps falling as it learns"** — until E4 proves a rising slope, the honest claim is *"one certified artifact cuts cost,"* singular.

**Escape hatch (the only path to an "improved" claim):** any "improved" string ships **only** behind a full-statistical-gate certificate — held-out, paired-bootstrap **CI lower-bound > 0**, blind reproducer, n ≥ power floor, BH-corrected — with **CI + n attached to the claim.** Gate-passing alone earns only the non-regression claim. This is a Release Gate line item (§5e), not a guideline.

---

## 3. THE TIER TABLE

**Boundary law: the billing line falls on the spawn line.** The implementation is *usage classification + spawn-gating*, NOT conserved-pool surgery (simpler, equally honest): the EffortPolicy decides which spawns are admitted — at `off`, no analyst/corpus/loop spawns are ever created — and every exported trace/outcome tags usage `{inferenceUsd, intelligenceUsd}` by class. At `off`, `intelligenceUsd` is provably 0 because zero intelligence spawns happened; the boundary is a property of what ran, not a split of the budget pool. The conserved `budget.ts` pool stays as-is; the genuinely-new mechanism is the EffortPolicy composer + the usage-class tag.

| Tier | Capability (which spawns admit) | Bills | Enforcement | #268 dial |
|---|---|---|---|---|
| **OFF** (`'off'`) | Base sandbox stream only. fanout 1, single-shot depth, analysts OFF, corpus OFF, loops OFF, lifecycle idle. **Telemetry export still on** (best-effort, near-zero cost — the upsell funnel). | **Inference tokens + sandbox compute ONLY** | `intelligenceUsd = 0` → every intelligence spawn refused at `reserve()` (`{ok:false,'budget-exhausted'}`); base stream untouched | **NEW floor below eco** |
| **ECO** (`'eco'`) | + analyst ON, cheapest model, 1 spawn; corpus READ-only; single candidate; no PR loop | + capped intelligence sub-budget | analyst budget requested **optionally** (reserve-or-skip) | eco |
| **STANDARD** (`'standard'`) | + corpus read/write, fanout 3, refine depth, gated-PR loop on checks, held-out gate | + intelligence per-action | full reserve gate per spawn | standard |
| **MAX** (`'max'`) | + every analyst, widen loops, lifecycle churn, max fleet slots | uncapped; all spend on the Pareto receipt | uncapped pool | thorough/max |

**Two required builds to make OFF real:**
1. **Split usd into `{inferenceUsd, intelligenceUsd}`** (or tag each reservation by class). Without this, billing *cannot prove* an OFF customer paid inference-only. This is the new mechanism.
2. **`'off'` compiles to `intelligenceUsd: 0`** in the EffortPolicy composer → `reserve()` refuses every intelligence spawn at admission. Reuses the *existing* fail-closed contract — no parallel feature flag.

**VERIFIED CORRECTNESS FOOT-GUN at the OFF/eco boundary** (confirmed in `analyst.ts` lines 92–118): `createScopeAnalyst` **hard-aborts the whole scope** (`AnalystError`) when a spawn is refused. Correct for an experiment ("never steer on an empty diagnosis"); **WRONG for a product OFF tier** — a customer with no intelligence budget must still get their base answer. Split the semantics:
- **Behavior-changing intelligence** (analyst steer, candidate promotion) fails-closed by **NOT RUNNING and letting the base stream return** — never by aborting the user's turn.
- **The experiment harness** keeps the hard-abort.
- The EffortPolicy composer requests the analyst budget **optionally** at off/eco (reserve-or-skip).

**Two orthogonal axes, not one switch:** OFF = "no PAID intelligence spawns"; Observe = best-effort telemetry. An OFF customer still emits traces for free dashboard visibility — collapsing them kills the upsell funnel. Extend #268's enum to `'off' | 'eco' | 'standard' | 'thorough' | 'max'` and comment the OFF row onto the issue.

---

## 4. THE 2-WEEK SLICE (real, not vaporware)

**What the customer touches first:** Mode 0 (Run/OFF) + Observe + the billing boundary. Wrap the agent, run a turn, see a trace, pay only inference. Marketed as *"observe + diagnose your agent,"* never "self-improving."

**Why it's real and not vapor — every dependency verified shipped:**
- `createOtelExporter` — fail-soft by construction (`return undefined` with no endpoint, line 85). ✅ shipped
- `sandboxExecutor` (the OFF base stream) — shipped, fails loud on misconfig (`runtime.ts:384`). ✅ shipped
- The box-provisioned router credential flow — **verified live twice** (200 + real completion); the inbox-creds fix is **already merged** (PR #271). ✅ shipped, NOT a blocker
- `egress-probe.mts` — **already exists** as the CI smoke. ✅ shipped
- `handleChatTurn` (the gtm wrap target) — shipped (`src/durable/chat-engine.ts`). ✅ shipped

**The only new code:** `src/intelligence/index.ts` (~200 LOC glue) + the budget-channel split. No `src/intelligence/` exists today (verified) — this is the single unblocking artifact.

**First customer: gtm.tangle.tools** (NOT Harvey). Already deployed on agent-runtime, already on the platform billing rail, richest live tool surface, friendliest checks, named first in the playbook. Harvey is **external** — repo access + contract + trust risk *before the wrapper has ever run in production.* Harvey/legal is case study #2.

**First PR / first turn (the go-live proof):** wrap gtm's production `handleChatTurn` with `withTangleIntelligence` in Observe mode, ship **one real user turn**, confirm the trace lands in `/v1/traces` AND live chat is unaffected when that endpoint is down. That single live trace + survived-outage = go-live.

**Harvest, don't rebuild:** cherry-pick `origin/examples/tangle-intelligence-export` (`8fa16af`, 122 LOC) into `examples/intelligence-drop-in/`; reconcile `origin/feat/observe-closed-loop` (`37e373f`) into the Phase-1 PR. Both branches exist (verified) — pay the re-discovery tax once.

---

## 5. THE RELEASE GATE (stricter than the doc gate — forced by the reset)

Ship Observe to gtm **only when all green:**
- **(a)** intelligence-OFF passthrough provably bills only inference (test against `/v1/billing`);
- **(b)** Observe export provably best-effort (live turn survives a dead `/v1/traces`);
- **(c)** redaction provably strips PII/secrets (promote the sanitized-collector test to a wrapper test);
- **(d)** NO quality-superiority string in any customer-facing surface;
- **(e)** *"No mode, doc, or PR body claims the agent is IMPROVED unless a full-statistical-gate certificate (held-out, paired-bootstrap CI lower-bound > 0, blind reproducer, n ≥ power floor, BH-corrected) backs it at reported n — gate-passing alone earns only the non-regression claim."*

**PR mode stays dark** until one real verified PR opens on an internal product with real checks (gtm/tax) AND the agenticGenerator verify-loop lands. (Note: "PR #276" in the proposed plan is unverified — the merged verify-loop work is `b152185` on `feat/agentic-generator-verify-loop` per `current.json` gen7; treat the PR number as a placeholder, gate on the **branch landing**, not the number.)

**Phasing:** Wk 1–2 = Mode 0 + Observe + billing on gtm (ship). Wk 3–6 = Recommend over real gtm traces (evidence-linked, **no code changes** — the safe value middle). Month 2 = Verified/Gated-PR on a product with real checks. Do **not** let the bold mandate push PR-mode into the 2-week window — it will fail the customer's checks and burn the relationship.

---

## 6. THE #1 BUILD AND THE #1 EXPERIMENT

**#1 BUILD — `src/intelligence/index.ts` + the conserved-pool usd split.**
`createIntelligenceClient` + `withTangleIntelligence(agent, config)` + `traceRun(meta, fn)` — a thin best-effort layer over the shipped `createOtelExporter` + the Mode-0 sandbox-stream base. Add the `./intelligence` export. **Cap at Observe + intelligence-off; do NOT bundle loops.** Bundle the `{inferenceUsd, intelligenceUsd}` split with it — without it there is no honest OFF tier, no billing boundary, no metered baseline for the cost claim. Everything in §4 depends on this one PR.

**#1 EXPERIMENT — E4: does the cost flywheel COMPOUND, or is it one-shot selection?**
The surviving thesis hinges on this. Every cost win so far is single-step and partly *selection, not accumulation* (E3c/E3d killed in-stream admission). "Cost keeps falling as the certified store grows" is **unmeasured** (no E4 doc exists yet — it's the designed-not-launched NEXT in `current.json`).
- **Domains:** EOPS-itsm + AIME (steer+compress promoted ×2 there).
- **Arms:** cold (no store) vs certified-store-n1 vs certified-store-n3 (3 offline-evolved, all displacer-reproducible/promoted), equal compute, under the **deterministic EOPS checker** (a deployable selector, NOT a judge).
- **Pre-registered falsifier:** if cost-per-task-at-fixed-quality does **not** monotonically fall as store size goes 0→1→3 with non-overlapping CIs, the flywheel is one-shot selection — and the honest claim shrinks to *"one certified artifact cuts cost,"* no "flywheel."
- **Decisive either way:** flat slope kills the flywheel narrative (product narrows but stays honest); rising slope is the program's **first compounding result** and the real headline. This decides whether we sell "we cut your cost once" or "your cost keeps falling."

---

## 7. THE SINGLE BIGGEST RISK + MITIGATION

**Risk: the retracted quality claim re-enters as marketing/product copy** — "verified-safe" silently upgraded to "verified-better," or "+16.4pp" resurrected in a deck. This is the program's own cautionary tale becoming the customer's broken promise. It is more likely than any technical slip because the *substrate is ready and the temptation under a "take risks / go live" mandate is highest exactly here.*

**Mitigation (structural, not vibes):**
1. **Release Gate (e)** blocks any "improved" string without an attached certificate + CI + n — enforced as a CI check that greps customer-facing strings and PR bodies for banned phrases (`improve`, `smarter`, `better`, `+Npp`) outside a certificate block.
2. **Rename "Verified PRs" → "Gated PRs"** at the contract level so the label cannot drift.
3. The **do-not-claim list (§2)** ships *in* `docs/intelligence-sdk.md` as a normative block, not a footnote.

**The #1 thing most likely to SLIP (timeline):** the **analyst fail-closed split** (§3 foot-gun). It's the one place the 2-week slice touches *behavior-changing* code rather than pure glue — splitting "fail-closed = don't run, return base stream" (product) from "fail-closed = hard abort" (experiment) without regressing the experiment harness's anti-Goodhart firewall. **Mitigation:** gate it behind the tier — at `'off'`/`'eco'` the composer requests analyst budget *optionally* (reserve-or-skip), so the product path never enters the abort branch at all; the experiment harness keeps its hard-abort untouched. De-risks the slip to a config boundary, not a semantics rewrite.

---

**Key files:** `/home/drew/code/agent-runtime/src/intelligence/` (create), `src/runtime/supervise/budget.ts` (usd channel split), `src/runtime/personify/analyst.ts:92-118` (split fail-closed semantics), `src/otel-export.ts:85` (Observe substrate, already fail-soft), `src/durable/chat-engine.ts` (gtm `handleChatTurn` wrap target), `src/runtime/supervise/runtime.ts:384` (`sandboxExecutor`, OFF base), `bench/src/egress-probe.mts` (CI smoke, **exists**), `docs/intelligence-sdk.md` (add Mode 0 + do-not-claim block). **Branches to harvest:** `origin/examples/tangle-intelligence-export` (`8fa16af`), `origin/feat/observe-closed-loop` (`37e373f`), `feat/agentic-generator-verify-loop` (`b152185`, gate PR mode on it landing). **Already done — remove from blocker list:** inbox-creds fix (PR #271, `49033aa`, merged); egress-probe (exists).