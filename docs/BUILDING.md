> **Track:** Reference | **Role:** building discipline | **Status:** canonical

# Building Guidelines

Prove the smallest real path, extend the existing primitive, and distinguish measured results from inference.

## Default Loop

For every substantive step, state:

- what is changing
- why it matters to the north star
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

Read development-tool pins from `package.json`. Keep Miniflare on the declared stable line.
TypeDoc and compiler-AST helpers need the development TypeScript compiler API;
`typescript-consumer` selects the separate compiler for packed compatibility checks.

Optimizer verification reads its Python requirement from [.python-version](../.python-version).
Normal Beelink gates provision the complete precompiled interpreter through [mise.toml](../mise.toml);
GitHub's Python setup reads the same version file. `PYTHON` remains an explicit local override.

One-shot fixture scripts use `node --import tsx` for TypeScript loading without the tsx CLI supervisor or IPC socket.
Arguments such as `--check` still reach the maintained generator.
Durable worker integration fixtures wait for actual executor entry after spawn
commit before steering or checking attach reasons. A returned spawn handle is
admission, and a child prestarted by a fixture does not prove Runtime execution.
Held executions are released and joined during cleanup, including failed assertions.

The parking process fixture compiles once with `tsdown` into an owned temporary directory, so child deadlines measure execution and exit.
Failures retain stage timing and process output there.

## Loop API Discipline

The blessed loop surface is the substrate:

- fixed shapes: `fanout`, `pipeline`, `loopUntil`, `panel`
- sandbox loops: `runAgentRounds`
- dynamic recursive trees: `Scope` + Supervisor
- sandbox driver binding: `createCoordinationTools`
- durable workspace: `gitWorkspace` over a `Shell`
- trace feedback: `observe`

Add a facade only after a tiny executable proof shows the substrate join and the
remaining boilerplate is irreducible.

## Documentation Placement

`release:prepare --amend-unpublished` absorbs pending notes into the current prepared
version only after a definite npm 404, absent local/remote tag, and matching published
predecessor. It regenerates derived files; the release gate still admits the archive's
actual compatibility and CHANGELOG before merge.

`release:tag <version> --commit <merged-sha> --gate <gated-sha>` requires a merged,
version-matching commit and the latest detached, successful normal/install Beelink
receipt for exactly `pnpm run release:check`; only tree equality permits attestation.
Existing tags are refused; defaults select fetched main and full hosted qualification.
Through `gh-drew`, tagging admits only the frozen qualifier's exact `refs/tags/v<version>`
after the immutable push, retaining every runner-group reference and restriction.
The organization owner serializes policy writes: GitHub has no conditional PATCH.
Observed policy drift fails; a pushed tag stays immutable if admission fails and its
exact qualifier reference needs owner reconciliation. Invoke `node scripts/tag-release.mjs` directly for metadata-only tagging, which needs no dependency
install. Frozen qualifiers must match reviewed main or an enrolled immutable workflow SHA;
mutable workflow references do not establish prior review for a diverged release line.

The frozen tag selects its reusable qualification workflow. Reviewed main owns release
line and gate-proof policy. Qualification reuses only the latest tree-bound status
issued by `drewstone`; missing, untrusted or mismatching evidence runs `release:check`.
A matching tree builds and qualifies exact archives without rerunning the source suite.
The local release gate runs the source suite, optimizer and benchmark verification once. `Publish` runs
the seven upstream contracts once, as its `evidence` job on the qualified archive; `publish-npm` needs it.
`scripts/run-upstream-contract.mjs --candidate --check all` previews them before tagging without
a release tag; default mode still requires exact tagged source. Publication retains cohort
compatibility, SHA256 locking, provenance, isolated npm authority and registry byte checks.

To verify an unpublished Sandbox SDK, pass its archive after the Runtime and Knowledge archive arguments to `scripts/verify-package-exports.mjs`.
Use an empty Knowledge argument to keep the installed release.
For the packed cohort, pass `--sandbox-archive` to test the publisher archive before npm serves it.
An archive for a prerelease of the newest matrix Sandbox adds a strict-install row alongside the stable Sandbox matrix.
Pass `--sandbox-repo` to pack a clean ADC checkout after its workspace dependency build.
The cohort gate strict-installs the selected archive and runs its proposal across the declared Sandbox matrix.

Packed-package manifest assertions perform no registry discovery. Cohort and package-export qualification import the live compatibility selections directly from [their owner](../scripts/lib/dependency-contract.mjs); conformance uses that same owner. Eval peer-window policy remains in those live compatibility checks. Official optimizer qualification checks authored peer ranges against actual workspace, packed and installed consumer versions.

The publish workflow checker follows the isolated qualification workflow and its
forwarded outputs, preserving default successful-dependency gating and unpublished-archive
admission for both packages. Each verifier exposes that condition only through its
required exact-archive npm admission step. Its optional publisher and qualifier paths
accept paired YAML snapshots for content checks; defaults read the repository workflows.

`verify:package` also installs the declared CLI Bridge, Tangle, Daytona and E2B development
versions beside the packed Runtime with strict peers. Its provider consumer compiles their
public types without casts and exercises transfer receipt and restart lookup through the
published CLI Bridge adapter with a bounded transport fixture. The destination environment
comes from the validated provider receipt. This check makes no cloud allocations or model
calls; live Braid handoff remains separate evidence.

- `CLAUDE.md` / `AGENTS.md`: bootloader and repo-local deltas only.
- `docs/BUILDING.md`: stable build rules.
- `docs/MAINTAINING.md`: the generated-vs-judgment docs split + the freshness gate.
- `docs/canonical-api.md`: the hand-curated JUDGMENT layer (decision table, when-to-use, "Do NOT"); per-symbol signatures are GENERATED into `docs/api/` — never hand-edit those.
- `docs/ANTI_PATTERNS.md`: named failure modes and stop signs.
- `docs/research/*`: evidence, postmortems, open designs, and dated decisions.
- the untracked `.evolve` run record and `memory/`: live state and measured results.

Link stable rules here from the bootloader; put experiment results in the evidence ledger.
