> **Track:** Reference | **Role:** building discipline | **Status:** canonical

# Building Guidelines

This repo is a measurement substrate as much as a runtime. The build style is:
prove the smallest real path, extend the existing primitive, and report what is
measured versus inferred.

## Default Loop

For every substantive step, state:

- what is changing
- why it matters to the north star
- why the obvious alternatives are worse
- how the claim was verified

## Rules

1. **Goal before execution.** Name the consumer, the decision this work changes,
and the axis that must discriminate before optimizing anything.
2. **Ground truth over inference.** Claims about behavior come from running the
   thing or reading the source. If a probe contradicts the model, the probe wins.
3. **Check existing before building.** Search for the primitive first. Extend it
   instead of forking it unless the new module can name the boundary it owns.
4. **Cheapest decisive check first.** Run the experiment that could invalidate
   the plan before the broad implementation or benchmark matrix.
5. **Verify before claiming.** Typecheck/lint/tests before "built"; live probe
   before "works"; artifact opened before "shipped."
6. **Estimate cost before launch.** State cells x per-cell-time / concurrency
   before any fleet, benchmark, or optimizer run.
7. **Separate roles.** Verifier accepts/rejects, judge scores held-out quality,
   analyst diagnoses traces, driver chooses action. Do not let judge output steer
   the current run.
8. **Keep durable state durable.** Commits, journals, result blobs, trace events,
   and corpus facts are the record. Do not rely on a string summary where a
   replayable artifact is available.
9. **Write down durable knowledge in the same turn.** Update the code map,
   evidence ledger, or process doc when the work changes how future agents
   should operate.

## Loop API Discipline

The blessed loop surface is the substrate:

- fixed shapes: `fanout`, `pipeline`, `loopUntil`, `panel`
- sandbox loops: `runLoop`
- dynamic recursive trees: `Scope` + Supervisor
- sandbox driver binding: `createCoordinationTools`
- durable workspace: `gitWorkspace` over a `Shell`
- trace feedback: `observe`

Add a facade only after a tiny executable proof shows the substrate join and the
remaining boilerplate is irreducible.

## Documentation Placement

- `CLAUDE.md` / `AGENTS.md`: bootloader and repo-local deltas only.
- `docs/BUILDING.md`: stable build rules.
- `docs/ANTI_PATTERNS.md`: named failure modes and stop signs.
- `docs/research/*`: evidence, postmortems, open designs, and dated decisions.
- `.evolve/current.json` and `memory/`: live state and measured results.

If a rule is timeless and applies across agents, put it here and link to it from
the bootloader. If it is an experiment result, put it in the evidence ledger, not
the bootloader.
