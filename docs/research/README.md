> **Track:** Architecture (research) · **Role:** design-research log · **Status:** consolidated 2026-06-15 (14 shipped/subsumed docs retired — see `deletion-ledger.md`)

# Research log — RSI driver architecture

Forward-looking design research for the recursive execution atom (agents driving agents;
analysts as agents; an async, observable, dynamically-spawning supervision tree). **This dir
is NOT canonical** — on any architecture conflict `../architecture.md` wins, and the LIVE
science state (every measured result, the current goal) is `.evolve/current.json`, not here.
Promotions into the spine happen explicitly, with `file:line` anchors, once a design ships.

**Start here:** [`../agent-managed-compute/README.md`](../agent-managed-compute/README.md) is
the active audit and implementation plan for distributed execution, recovery, provider-backed
workers, and run-API convergence.
`.evolve/current.json` remains the live evidence ledger for experiments.
The research files below are source history and focused design inputs, not competing build plans.

## Live docs

| Doc | What it holds |
|-----|---------------|
| [learning-system-audit-2026-09-05.md](./learning-system-audit-2026-09-05.md) | Current-source audit of learning across Runtime, Eval, and Knowledge, with reproduced failures and a unification design. |
| [rsi-atom-masterplan.md](./rsi-atom-masterplan.md) | Historical self-designing-atom plan. Distributed execution work is superseded by `agent-managed-compute/`. |
| [optimization-space.md](./optimization-space.md) | The 6-axis optimization taxonomy + canon-compatibility audit (the portfolio map the canonical spine references). Per-layer evidence now lives in `.evolve/current.json`. |
| [leapfrog-program.md](./leapfrog-program.md) | The research program's honest formal core (v2 — breakthrough framing retracted; what survived). |
| [belief-state-learner-spec.md](./belief-state-learner-spec.md) | **Gated (BUILD-ON-GREEN).** The belief-state / program-synthesis learner spec — its design, not a build order; waits on a positive deployable-selector gate. |
| [belief-agent-research-agenda.md](./belief-agent-research-agenda.md) | **Gated.** Research agenda for the recursive/belief-state agent (7 lenses → ranked agenda), grounded against the gate result. |
| [harness-compat.md](./harness-compat.md) | Harness × capability matrix — what a driver can actually steer per harness. |
| [long-horizon-agent-map.md](./long-horizon-agent-map.md) | Historical long-horizon product map and design input. |
| [atom-compression-plan.md](./atom-compression-plan.md) | The self-designing atom's cut-list + build-list (feeds the deep-clean). |
| [loop-facade-postmortem.md](./loop-facade-postmortem.md) | **Active guardrail.** Failure record for the deleted `defineLoop` facade + the prevention rule. |
| [environment-provider-adapter-spec.md](./environment-provider-adapter-spec.md) | Generic environment provider adapter spec: what to lift from sandbox SDK, cli-bridge, runtime routing, and profile execution so third-party compute/sandbox providers can plug in. |
| [deletion-ledger.md](./deletion-ledger.md) | The deletion record for the `chore/atom-deep-clean` passes. |

## Moved to the run archive ([tangle-network/agent-lab](https://github.com/tangle-network/agent-lab), private)

The experiment programs + their run artifacts live with the runners, not here:
[adaptive-computation-program.md](./adaptive-computation-program.md) ·
[e3-certified-memory.md](./e3-certified-memory.md) ·
[factorial-ablation-design.md](./factorial-ablation-design.md).

## Retired 2026-06-15

14 design-research docs were retired in the doc-consolidation pass — design that became code
(the recursion atom shipped), measured results now in `.evolve/current.json`, or self-declared
subsumed/retracted. The list + rationale is in [`deletion-ledger.md`](./deletion-ledger.md)
(Pass 2). Their durable conclusions live in the SSOT, `architecture.md`, and the evidence ledger.
