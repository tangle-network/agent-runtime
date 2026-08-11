# Prime Agent as a harness — boundary, adoption map, substrate wish-list

> **Status: decision record + integration contract.** Prime Agent (Prime Intellect's
> local agent OS: persistent IPython kernel, daemon-backed session trees, native `rlm(…)`
> subagents, `/refine` continual-harness edits) is being added as a **sandbox-materialized
> harness** — the sandbox/adc side owns the image and the adapter; the harness id shipped
> as `prime` in `agent-interface` and the sandbox backend enum. This doc owns the Runtime side: the boundary we hold, which proposed
> integration machinery we adopt or reject (most of it already exists here), and the
> concrete asks on the substrate. On architecture conflict,
> [architecture.md](../architecture.md) wins.

## 1. The boundary (the one non-negotiable)

**A harness owns its native inner model/tool/subagent loop. Runtime owns the external
execution identity, budget, lifecycle contract, and cross-harness coordination. Agent
Eval owns verdicts. Intelligence owns promotion.**

This is not new policy — it is [canonical-api.md §1.5](../canonical-api.md) applied to a
harness that happens to be unusually complete. Acceptance criteria:

- No Prime-specific inner-loop logic enters Runtime. Prime's IPython surface, session
  JSONL schema, daemon protocol, and TUI are harness features, not Runtime contracts.
- No Runtime tool loop wraps Prime's own loop. Prime is a **leaf** behind the one
  `Executor` port / a sandbox backend, exactly like claude-code or codex.
- Prime's local `AgentConnection`/daemon protocol never becomes a public Runtime API.
  Callers see opaque run ids, session ids, artifact refs, and receipts.
- A stronger harness is a reason to author better profiles, never to specialize Runtime:
  a lever Prime exposes that the profile cannot yet express is a **materializer gap in
  the substrate**, not a bespoke Prime adapter here.

## 2. Anti-reinvention map — what the integration needs that already exists

Most of the machinery a "host Prime properly" plan calls for is built. Reuse it.

| Integration need | Existing primitive | Where |
|---|---|---|
| Harness identity + per-harness capability truth | `HarnessType` + the harness-capability layer (model lock, reasoning clamp, selector honoring) | `@tangle-network/agent-interface` (`harness.ts`, `harness-capabilities.ts`) |
| Environment capability negotiation (streaming, sessions, workspace, **checkpoint/fork**) | `AgentEnvironmentCapabilities` incl. `branching.checkpoint/fork`; `AgentEnvironment.checkpoint()/fork()` | `src/runtime/environment-provider.ts` |
| Portable capability with per-harness lowerings ("one skill, many bindings") | `CertifiedCapability` = `{ iface, binding, auth, provenance }` — interfaces closed, bindings open; a Prime Python skill is one binding arm (`file`/`sandbox-code`), never a new manifest format | `src/intelligence/capability.ts` |
| Execution-identity receipts (what exactly ran) | `materialized` journal event (authored/effective profile + platform-attachment digests), `RunProvenance.mounts`, `SelectionReceipt`, usage integrity guard | `src/runtime/supervise/`, `src/runtime/types.ts` |
| Frozen candidate identity + workspace bytes | `buildAgentCandidateBundle` / `captureAgentCandidateWorkspace` | `src/candidate-execution/` |
| Improvement governance (train/selection/final-test partitions, review, activation, rollback receipts) | `improve()` + `proposeAgentImprovement` → `reviewAgentImprovementProposal` → activation | `src/improvement/`, `src/intelligence/` |
| Equal-compute topology comparison + holdout gates | conserved budget pool (`src/runtime/supervise/budget.ts`), `promotionGate`, `pairedLift`, `heldOutGate` | `src/runtime/promotion-gate.ts`, `bench/src/stats.mts`, `@tangle-network/agent-eval` contract |
| Harness × model × task matrix | `defineLeaderboard` / `runProfileMatrix` (harness×model axes) | `src/runtime/define-leaderboard.ts`, `@tangle-network/agent-eval` campaign |
| Harness-agnostic trace normalization | `TraceSource` + the per-harness `toolPartDecoders` registry (add a harness = one validated decoder entry) | `src/runtime/supervise/trace-source.ts` |
| Uncertain-effect posture after restart | uncertain reservations charged at full declared budget with telemetry explicitly unknown; instruction receipts retained as evidence, never auto-redelivered | `src/runtime/supervise/budget.ts`, `supervise/coordination-mcp.ts` |
| Prime Intellect ecosystem bridge (verifiers env packaging, trace import) | `writePrimeIntellectPackage`, `importPrimeIntellectTraces` → `RunRecord` | `src/primeintellect/` |

## 3. What Runtime adopts

### 3.1 Surface-diff harvest (built — `harvestSurfaceDiffs`, `/kernel`)

The harness-agnostic generalization of Prime's `/refine` observation, and the read-back
dual of the mount manifest: `RunProvenance.mounts` records what the substrate placed into
a run (instructions, skills, memory); `harvestSurfaceDiffs({ mounts, read })` re-hashes
those surfaces at settle and reports what the agent itself changed
(`src/runtime/surface-diff.ts`). Every harness self-mutates this way — claude-code edits
CLAUDE.md/memory files, opencode edits AGENTS.md, Prime edits its continual harness — and
today that evidence evaporates at box teardown.

The harvest is **caller-invoked at settle by the same caller that recorded the mounts**
(the kernel never reads workspace contents itself — same law as `recordMount`). Two
shipped readers join it to real substrates: `boxSurfaceReader` rides the same
`box.fs.read` seam `openSandboxRun` reads deliverables through; `fsSurfaceReader`
covers worktree/local workers. Surfaces the agent *created* (a new memory file — the
common `/refine` outcome) are covered by `watch` entries: the caller enumerates the
harness-state paths it cares about (e.g. via the box file tree) and never-mounted
paths that now exist report as `created`.

The scope law it feeds (Prime's `/refine` scopes, generalized to any harness):

- **Session-scoped self-edits are observations.** They applied during the run, they are
  recorded (path, mounted/settled hashes, source), they promote nothing.
- **Reuse-scoped edits become candidates.** A diff worth keeping is materialized through
  the existing proposal pipeline (`proposeAgentImprovement` → review → gated activation)
  and must clear the same held-out, equal-compute gate as any other candidate. An LLM
  rationale ("expectedOutcome") is never promotion evidence — the trajectory that
  motivated an edit is not an independent measurement of it.

### 3.2 The `prime` id — shipped and wired

The id shipped as **`prime`** in `agent-interface` (`HarnessType`; capability rows for
its reasoning ladder and system-prompt semantics) and in the sandbox backend enum, and
`'prime'` is in `harnessBackends` (`src/runtime/sandbox-backend.ts`) — the
double-`satisfies` pin keeps the three enums aligned at compile time. Two follow-ups
remain, each gated on evidence rather than releases:

1. Register a `toolPartDecoders['prime']` entry — ONLY once validated against Prime's
   real session output (the registry law). If the substrate normalizes into the
   canonical `ToolPart` (wish-list item 3), the existing decoder covers it and the
   entry is a one-line alias; until then unregistered harnesses fall through to the
   try-all composite, which is correct.
2. Fill the **measured** `prime` column in
   [research/harness-compat.md](../research/harness-compat.md). Prime is Pi-lineage but
   not Pi (the fork's daemon rejects pi-line clients): do not inherit `pi`'s capability
   row by assumption.

## 4. What we deliberately do NOT build

- **A `TopologyAuthority` type.** The fear it answers — Runtime spawns 5 Prime roots,
  each spawns 5 native children, unbounded — is structurally impossible here: a worker's
  native subagents spend **inside its conserved-budget reservation** (`supervise/budget.ts`),
  so no arm can buy more compute regardless of what the harness does internally. The
  layering doctrine already assigns native orchestration to the harness (layer one) and
  cross-harness composition to Runtime. The three "modes" are expressible today as
  authoring decisions: harness-owned = spawn one worker and let it expand; runtime-owned
  = author a profile with native subagents disabled (where the harness supports it — see
  the compat matrix); hybrid = the default. What is genuinely missing is *visibility*
  into native children (wish-list 4) and *fan-out caps as a materializable profile lever*
  (wish-list 8) — observability and configuration, not a new authority enum.
- **A `HarnessExecutionReceipt` envelope.** The fields exist across the `materialized`
  journal event, `RunProvenance`, the budget ledger, and candidate bundles. Missing
  fields (environment/image digest, harness version, harness-state digest, snapshot
  refs) are substrate facts — the fix is the substrate *reporting* them (wish-list 5) so
  existing receipts can carry them, not a parallel envelope Runtime must keep consistent
  with the ones it already emits.
- **An `AdvancedHarnessBackend` optional-method interface.** Capability truth lives in
  agent-interface (`harness-capabilities`, `AgentEnvironmentCapabilities`) and behavior
  behind the existing ports (`Executor.progress`/`traceSource`, provider
  `checkpoint`/`fork`). Growing the backend port into a 10-optional-method surface
  re-creates the closed adapter zoo the one `Executor` port replaced.
- **A persistent-kernel / programmable-computer abstraction in Runtime.** Prime's IPython
  surface is a strong cognitive substrate and a real reason to route long-horizon
  data-heavy tasks to Prime — via the leaderboard matrix and profile authoring, not via a
  Runtime kernel API. If the pattern proves out empirically, the portable expression is a
  capability binding (a code-execution MCP) any harness can mount, measured like any
  other candidate.
- **Prime's daemon/durability layer inside Runtime.** Reconnect, leases, adoption,
  replay cursors belong to the sandbox/orchestrator boundary (see
  [agent-managed-compute/](../agent-managed-compute/)). Prime's daemon patterns
  (generation-aware cursors, claim-before-delivery, explicit uncertain mutations) are
  good prior art for that work where Runtime doesn't already have the equivalent.

## 5. Substrate wish-list (the asks on `@tangle-network/sandbox` / adc)

Numbered so the sandbox-side work can check them off. Items 1–5 are required for
instrumented runs; 6–9 unlock the experiment tier.

1. **Harness identity — DONE.** Shipped as `'prime'` in `HarnessType` (agent-interface,
   with reasoning-ladder and prompt-channel capability rows) and as a sandbox
   `backend.type` — a distinct id, not `pi`. The remaining capability facts (model lock,
   selector honoring per the real CLI) still land measured, not inherited.
2. **Profile materialization.** Render an `AgentProfile` into Prime's native surfaces —
   system-prompt addendum, skills (as Prime executable skills or SKILL.md), MCP config,
   subagent specs, hooks where expressible — with the standard materialization receipt
   (exact mounted bytes + digests). A profile lever Prime cannot express must fail loud
   in the materializer, not silently drop.
3. **Canonical tool parts.** Normalize Prime session output into agent-interface's
   published `ToolPart`/`ToolState` (terminal-state semantics + `callId` dedup), the
   shape every adc sdk-provider already targets. Then Runtime's existing decoder handles
   Prime with zero new decode logic. If normalization is impossible for some part kinds,
   publish the raw wire shape so a decoder entry can be *validated* (the registry rule:
   a decoder lands only checked against the harness's real output).
4. **Native session tree exposure.** Prime's root session and `rlm` children as
   session-tree metadata (session id + parent id + status + per-child usage) readable
   off the box. Runtime projects these as child spans/runs; without it a Prime worker is
   one opaque blob and per-child cost attribution is lost.
5. **Environment identity reporting.** Image digest, Prime version, Python-environment
   digest, and a continual-harness state digest surfaced on the box/session so run
   receipts can bind results to the *effective* behavioral identity (profile digest alone
   under-identifies a harness with mutable local state).
6. **Kernel-cell and effect visibility.** One IPython cell can read 100 files, hit the
   network, and spawn children. Surface cell start/end, shell subprocesses, and file
   effects as parts or a metadata channel so trace analysts see causal structure, not
   one giant tool call. (Order/count first; byte-accurate effect receipts can come
   later.)
7. **Refinement events.** Prime `/refine` plans and applied edits (scope, surface,
   before/after hashes, rationale) surfaced on the session stream, and scope policy
   enforceable at materialization: session-local edits apply freely; project/global
   edits are emitted as events for the host to lift into proposals, never self-applied
   to shared state from inside a run. During gated evaluation: auto-refinement off,
   candidate and baseline harness state frozen and separated.
8. **Fan-out caps as config.** Prime's native child limit (and equivalents on other
   harnesses) as a materializable knob so an authored profile can bound native expansion.
9. **Checkpoint/branch coverage for the Prime process tree.** The mechanism already
   exists — `box.snapshot()` / `box.branch(count)` in the sandbox SDK, the kernel's
   CRIU capability probe (`SandboxClient.criuStatus`) and fork lineage
   (`LoopLineageOptions.forkFanout`), and the `AgentEnvironment.checkpoint()/fork()`
   contract. The ask reduces to: **verify** a CRIU/box snapshot actually covers the
   Prime daemon + IPython kernel process tree (a whole-box checkpoint should capture
   kernel heap by construction — verify, don't assume), and report the answer through
   the environment capability row. A transcript-tree branch is not a world branch;
   paired baseline/candidate arms need same-state forks. Credentials stay short-lived
   and injected — never serialized into snapshots, session JSONL, or harness state.

**Adapter shape note.** Prime is daemon-backed with persistent sessions, which maps more
naturally onto the `AgentEnvironmentProvider` contract (sessions, capability
negotiation, `checkpoint`/`fork` — `src/runtime/environment-provider.ts`) than onto a
plain one-shot `backend.type`. Both integration shapes reach Runtime through existing
ports (`providerAsExecutor` / `providerAsSandboxClient` on one side, `buildBackendOptions`
on the other); the sandbox side should pick per tier — box backend for basic runs,
provider for instrumented/experiment tiers — rather than forcing one.

## 6. The first gated experiment (when 1–5, 7, 9 land)

One question, run through the existing machinery (no new rig): **does a
`/refine`-derived edit improve held-out tasks, or only continuity on the task that
produced it?** Source tasks generate candidate edits; `improve()`'s partitions select
and hold out; both arms run frozen harness state at equal compute under a deployable
verifier; `proposeAgentImprovement` carries the winner to review. Ablate edit kinds
(memory / skill / subagent spec / bundle) against a same-size generic-edit control.
Powered paired n per the eval substrate's rules — not anecdotes. Separately (never in
the same causal claim): Prime vs other harnesses on the same profile via the
leaderboard matrix.
