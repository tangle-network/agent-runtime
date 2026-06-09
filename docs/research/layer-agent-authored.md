> **Track:** Architecture (research) · **Role:** layer stress-test · **Status:** newly feasible — the skillification goal, unmeasured

# Layer: agent-authored optimization (skillification)

**The claim under test:** agents can author the optimization machinery themselves —
read a run's failures, write a *new strategy* (code, not prompt), and have it gated like
any human-built candidate. This is the stated product goal ("skillify the process so
agents develop these complex things") and the literal RSI claim, one level up from
prompt mutation.

## Why this just became feasible

Before `defineStrategy`, a strategy was a ~70-line Supervisor driver (spawn/scope/
journal ceremony) — not a unit any agent emits reliably. Now a strategy is a **~20-line
body composing two steps** (`shot()`, `critique()`) with the ceremony hidden, proven by
`adaptiveRefine` (branch-when-stuck, authored from the steps, runs through the canonical
gate). The skillifiable unit exists; what's missing is the skill and the measurement.

## The two safety properties that make agent authorship sound

These are structural, not policy — which is what makes this layer credible at all:

1. **Equal-compute by construction.** Any authored strategy spends through the
   Supervisor's conserved budget pool — it *cannot* win by spending more (the
   anti-confound invariant the keystone was built for).
2. **The firewall is structural.** A strategy body composes `shot`/`critique`; it never
   receives the verifiers or expected values. An authored strategy can be wrong but
   cannot Goodhart the check — the judge stays write-only regardless of who wrote the
   code.

Residual risks that are NOT structurally covered: infinite-loop bodies (cap: the budget
pool exhausts → spawn refused → strategy ends), environment abuse via tool calls (same
exposure as any worker — the Environment's own tool surface is the boundary), and
plain bad code (gate + holdout catches uselessness; typecheck catches breakage).

## The experiment (the strategy-author skill)

A skill/agent given: the `defineStrategy` contract + the two steps' docs + a run's
**losses** (per-task: breadth score, depth score, trajectory — already emitted by the
GEPA fitness fn) — asked to author one new strategy attacking the observed failure
mode. The authored strategy enters the same tournament as human-built ones
(`runBenchmark`, n≥24, frozen holdout).

Success ladder (each rung independently informative):
- **R0** — the agent emits a strategy that typechecks and completes the gate. (Pure
  feasibility; expect pass.)
- **R1** — an authored strategy beats `sample` on the holdout. (Parity with human
  baseline quality.)
- **R2** — an authored strategy beats the best *human* strategy on the holdout. (The
  actual RSI-one-level-up claim.)
- **R3** — iterated: feed the authored strategy's own losses back; does generation 2
  beat generation 1? (GEPA-over-code; this is meta-harness's territory and should run
  through that skill's discipline — stable baseline + product-value claim — not a
  hand-rolled loop.)

## Stress test

- *"Isn't this just GEPA with a bigger search space?"* Materially different: prompt
  space was measured flat (holdout tie); *program* space contains things prompts cannot
  express (branch-when-stuck, restart policies, multi-artifact coordination, team
  topologies). The prior is genuinely open.
- *"LLMs write plausible-broken control flow."* R0 exists precisely to measure the
  emission reliability before claiming anything; the gate absorbs broken candidates as
  scored losses, not crashes (the resilient harness skips, never dies).
- *"Multi-agent teams?"* Same unit: a "team" is a strategy whose body spawns several
  *different* agents and arbitrates — the recursive atom already expresses it; the skill
  just needs one team-shaped example in its docs.
- *"Why a skill rather than a workflow?"* The skill is the productization: it travels to
  any repo with the substrate, and it is the artifact that makes "agents develop these
  complex things themselves" true for users, not just for this bench.

## Order of operations

1. Write the strategy-author skill (input: losses + contract; output: a
   `defineStrategy` file + rationale). Small.
2. R0/R1 on the existing EOPS gate (cheap, reuses everything).
3. R2 tournament: authored vs `refine` vs `adaptiveRefine` vs `sample`, n≥24 + holdout.
4. R3 only through `meta-harness` discipline, gated on R2 signal.
