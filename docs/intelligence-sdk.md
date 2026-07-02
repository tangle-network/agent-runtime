> **Track:** Reference · **Role:** product SDK reference · **Status:** shipped — Observe + the OFF billing floor + effort tiers + redaction + certified delivery + the capability resolver all ship at `@tangle-network/agent-runtime/intelligence`. The Recommend/PR/Loop *client verbs* are designed, not shipped — see [Designed, not shipped](#designed-not-shipped).

# Tangle Intelligence SDK — the `/intelligence` subpath

What a product team imports to adopt Tangle Intelligence: wrap an existing agent, ship traces UP to the plane, and receive gate-certified improvements DOWN into the running agent — without becoming eval engineers.
Per-symbol signatures live in the generated [api/intelligence.md](./api/intelligence.md); this doc is the judgment layer: what to use when, and the invariants each piece guarantees.

## Quickstart

```ts
import { withTangleIntelligence } from '@tangle-network/agent-runtime/intelligence'

export const agent = withTangleIntelligence(myAgent, {
  project: 'legal-agent',
  apiKey: process.env.TANGLE_API_KEY,
  repo: { owner: 'acme', name: 'legal-agent', baseBranch: 'main' },
  checks: ['pnpm test', 'pnpm typecheck'],
  surfaces: ['src/agent/**', 'src/tools/**', 'skills/**'],
})
```

`withTangleIntelligence` wraps any `(input) => Promise<output>` agent and returns the same shape: each call runs under a trace and exports one span, best-effort.
`repo`, `checks`, and `surfaces` are recorded for `IntelligenceClient.doctor()` readiness only — the Observe slice never touches the repo.
Prove it offline: `pnpm tsx examples/intelligence-drop-in/intelligence-drop-in.ts` ($0, no credentials — it reads the exported span back and asserts the OFF tier's `intelligence_usd` is 0).

## Normative claims policy

The customer claim the evidence backs: **"Agents that get verifiably smarter and cheaper — proven on held-out evidence, not lucky streaks."** We *do* make agents smarter — via **gated search** (spend compute to find a better artifact, certify the winner), not a within-run trick that beats blind at equal compute. Once certified, the better artifact is cheap to serve. Two replicated survivors back this: certification rigor predicts transfer (gate-certified artifacts transfer, +31.7/+36.7pp holdout, twice); the cost flywheel (certified memory + compression hold quality at −12 to −31% cost). **The gate is the moat, not the disclaimer** — everyone else sells improvement from lucky streaks; we attach the held-out evidence.

**DO-NOT-CLAIM (normative — "smarter" is allowed ONLY with its gate, CI, and n attached; un-gated efficacy claims must not reach a customer surface):**

1. ✗ "smarter for free / by steering / without spending more compute" — the within-run-cleverness-beats-blind mechanism collapsed to a tie (+4.1pp CI[−1.6,+10.2] at n=72); smarter comes from gated search, not a free trick. ✓ ALLOWED: "we search for a better config and ship it only when it clears a held-out gate."
2. ✗ a bare quality lift ("+16.4pp", "depth beats breadth") with no CI and n — the n=16 headline was an underpowered streak. ✓ ALLOWED: a lift *with* its paired-bootstrap CI and n.
3. ✗ "Verified PRs improve your agent" — a passing-checks PR proves **non-regression on the customer's n**, not improvement. This mode is **"Gated PRs / Verified-Safe PRs."**
4. ✗ "self-improving / learns and gets better over time" — accumulation is unproven; only selection of one certified artifact is real.

**Escape hatch — the ONLY path to an "improved" claim:** a full-statistical-gate certificate (held-out, paired-bootstrap CI lower-bound > 0, blind reproducer, n ≥ power floor, BH-corrected) with CI + n attached. Gate-passing alone earns only the non-regression claim.
The delivery code enforces the same framing: a `CertifiedArtifact` carries its held-out gate lift, never a within-run claim.

## Observe — traces UP

`createIntelligenceClient(config)` builds the Observe client. `IntelligenceConfig`:

- `project` (required) — the tenant dimension every trace is tagged with.
- `apiKey` — bearer key for the ingest; reads `TANGLE_API_KEY` when omitted.
- `effort` — a tier name or `{ tier, overrides }`; default `standard`. See [Effort tiers](#effort-tiers-and-the-off-billing-floor).
- `endpoint` — OTLP ingest base (the exporter appends `/v1/traces`). Reads `INTELLIGENCE_OTLP_ENDPOINT` then `OTEL_EXPORTER_OTLP_ENDPOINT` when omitted; absent all three, export is a no-op — best-effort by construction.
- `redact` — a `Redactor` replaces the default scrubber; `false` opts out loudly; omitted ⇒ `defaultRedactor`. See [Redaction](#redaction).
- `surfaces` / `checks` / `repo` — declared for `IntelligenceClient.doctor()` readiness only.

The client surface:

- `client.traceRun(meta, fn)` — run `fn` under a trace, export one span, return whatever `fn` returns. The `TraceHandle` captures output via `trace.recordOutput(output)` and outcome via `trace.recordOutcome({ success, score, costUsd, usage })`; a bare `costUsd` with no split is treated as pure inference.
- `client.recordTrace(events, meta)` — export a run's full `LoopTraceEvent` stream as a nested OTLP span tree (loop → round → iteration) through the shipped `buildLoopOtelSpans` builder, never a second span builder. Returns the resolved trace id; `meta.rootParentSpanId` parents the loop root under an enclosing span.
- `IntelligenceClient.doctor()` — network-free readiness report (see the adoption ladder below).
- `client.flush()` — flush pending spans; resolves even if export fails.

The best-effort law: telemetry-export failures are swallowed — a live agent never fails because Intelligence is down — but an error thrown by the agent itself propagates unchanged.
Every span carries the billing split as attributes (`tangle.usage.inference_usd`, `tangle.usage.intelligence_usd`, `tangle.effort.intelligence_off`); inputs/outputs pass through the redactor and are bounded to a 4 KB preview on the span.

## Two lanes: traces UP, certified artifacts DOWN

Observe sends traces UP to the plane. The delivery half pulls certified artifacts DOWN: the tenant's promoted, gate-certified profile is read from the deployed Intelligence plane and folded into the running agent — so an approved improvement actually reaches production. Pull contract:

```
GET {base}/v1/profiles/:target/composed
Authorization: Bearer <TANGLE_API_KEY>
```

The base URL reads `TANGLE_INTELLIGENCE_URL`, defaulting to the deployed plane at intelligence.tangle.tools. Four entrypoints, all fail-closed:

- `pullCertified(opts)` — one pull, returning a typed `PullOutcome` (inspect `succeeded` before `value`); it never throws. A 404 is the normal "nothing promoted yet" signal, carried as `status: 404`; a hung plane is cut by the 10-second default timeout and surfaces as an ordinary failed pull.
- `createCertifiedPromptSource(opts)` — the cached, self-refreshing source: pulls at most every 5 minutes (`refreshMs`), coalesces concurrent pulls, and keeps the last-known profile on a failed or 404 pull — a good surface is never wiped by a bad refresh.
- `composeCertifiedPrompt(base, certified)` — folds the certified prompt surface plus the prompt-folding artifact buckets (`promptFoldTypes`: prompt-surface, skill, instructions) into the base prompt under a marked section. The fold is byte-stable — prompt surface first, then bucket order, then path order — so the same profile renders identically on every call; it returns `base` unchanged when nothing usable is promoted.
- `withCertifiedDelivery(agent, config)` — the wrapper that rides both lanes at once:

```ts
import { withCertifiedDelivery } from '@tangle-network/agent-runtime/intelligence'

export const agent = withCertifiedDelivery(
  async (input, applied) => myAgent(input, { systemPrompt: applied.composePrompt(BASE) }),
  { project: 'support-agent', target: 'support-agent' },
)
```

Each call refreshes the certified profile (window-respecting), hands the agent an `AppliedIntelligence` handle (`certified` + `composePrompt`), and Observes the run with the certified version stamped on the span.
When the plane promotes a new gate-certified surface, the next refresh delivers it to the running agent; when the plane is unreachable, the agent runs on its base surface.

### The capability resolver

Prompt folding covers text artifacts. `composeCertifiedProfile(base, manifest, ctx)` lowers a full `CapabilityManifest` — tools, MCP servers, files, hooks, subagents — into one `ResolvedSurface` consumed identically by the in-process seam (tool specs + an executor + the folded prompt) and the sandbox seam (an agent profile).
`composeCertifiedProfileFromWire` accepts the plane's `CertifiedProfile` wire shape directly, via `manifestFromProfile`.

Everything that touches a network, a secret, or an infra provisioner is injected through `ResolveCtx`: `resolveSecret` (per-tenant, typed outcome), `runSandboxCode`, `provisionHost` (returns a `ProvisionedHost` with a teardown), `probeLiveToolNames` (the post-resolve drift probe), and `onDrop` (observe a dropped capability).
A binding that needs an absent provider fails loud — it is never faked into a working surface.

Admitted binding kinds: inline, file, http, sandbox-code, mcp-stdio, mcp-remote, and the recursive process-on-infra (a host provisioned before its inner binding).
The typed-but-unadmitted arms (rag-index, memory-store, wasm, a2a) throw `CapabilityNotAdmittedError` at resolve — a hard error, never a silent no-op.
Any other per-capability failure is a fail-closed drop surfaced via `onDrop` (the capability is omitted, never half-wired); when `probeLiveToolNames` is wired, the drift check drops any tool whose live names diverge from the certified interface, so the only callable surfaces are gate-blessed ones.

Design rationale: [archive/capability-delivery-manifest.md](./archive/capability-delivery-manifest.md). Full generated types: [api/intelligence.md](./api/intelligence.md).

## Effort tiers and the OFF billing floor

`resolveEffort(tier, overrides)` compiles a named tier into flat `EffortSettings`; an unknown tier fails loud rather than silently defaulting. The presets:

| Tier | analysts | corpus | fanout | loops | intelligenceBudgetUsd |
|---|---|---|---|---|---|
| `off` | false | off | 1 | false | 0 |
| `eco` | true | read | 1 | false | 0.25 |
| `standard` (default) | true | read-write | 3 | true | 2 |
| `thorough` | true | read-write | 5 | true | 10 |
| `max` | true | read-write | 8 | true | null (uncapped) |

`intelligenceBudgetUsd` caps INTELLIGENCE-class spawns only (analysts, corpus, loops) — base-stream inference bills on its own channel and is never constrained here.

Below the paid tiers sits **OFF**: the agent runs as pure passthrough with best-effort telemetry still on, paying inference + compute only.
OFF is the honest baseline the cost claim is measured against, the fail-closed degrade target, and the floor a customer can always opt down to.
Billing law: **the billing line falls on the spawn line** — base-stream tokens bill as inference, every intelligence spawn bills as intelligence, and every trace tags usage by class as a `UsageSplit` `{ inferenceUsd, intelligenceUsd }`.
`isIntelligenceOff(settings)` is the passthrough predicate: every axis must be off — a caller who overrides any one back on is no longer at the floor.
The floor is a hard invariant, not a default: the wrapper clamps the intelligence spend to 0 on export rather than trusting the caller, so the billing proof holds even against a mis-recorded outcome.
`compileEffort(settings)` bridges the pure policy to run-config knobs (`EffortOverridesCompiled`: whether to construct an analyst, the fanout width, whether loops run, the budget) so no effort branching leaks into the loop kernel.

**Product fail-closed ≠ experiment fail-closed:** behavior-changing intelligence (analyst steer, candidate promotion) fails closed by **not running and letting the base stream return** — never by aborting the user's turn.
The experiment harness's hard-abort in `createScopeAnalyst` is correct for research and wrong for a product OFF tier; the compiled overrides encode the product degrade (omit the analyst, don't throw).

## Redaction

Every exported input/output passes through a `Redactor` before it leaves the process.
The built-in `defaultRedactor` replaces values under secret-bearing keys wholesale (API-key/token/password/credential/cookie classes), scrubs in-value patterns from every string (bearer tokens, provider-style API keys, AWS access key ids, PEM private-key blocks, emails), walks nested objects and arrays, and is cycle-safe and depth-bounded — it never throws on customer input.
A caller-supplied `redact` hook replaces the default entirely (the customer owns their PII rules); `redact: false` is the explicit, loud opt-out for a caller that has already sanitized upstream and wants raw fidelity.

## Adoption ladder

| Mode | Status | Customer Code | Platform Output | Required Inputs | Safe Default |
|---|---|---:|---|---|---|
| Observe | **shipped** | 10-50 LOC | traces, costs, failures, dashboard | project id, API key, entrypoint | best-effort export |
| Recommend | **partial** — the trace→findings→improvement path ships offline; the hosted client verb is designed | 50-100 LOC | failure clusters, suggestions, issues/reports | traces, outcome mapping | human review |
| Verified PRs | **designed** — the readiness check ships | 100-300 LOC | branch/PR with passing checks | surfaces, checks, repo access | fail closed |
| Advanced Loops | **designed** — the loop substrate ships | 300+ LOC | scheduled optimization, holdout gates, matrix runs | eval adapter, budgets, gates | explicit opt-in |

`IntelligenceClient.doctor()` reports exactly this ladder without a network call: Observe is always ready; Recommend needs effort above off; PR needs checks + surfaces + repo; `exportConfigured` says whether an OTLP endpoint is set.
If a product has no checks, it is not eligible for PR mode. If it has no traces, it is not eligible for credible recommendations. If it has neither, start at Observe.

Recommend today, without the hosted verb: record a run's trace with `client.recordTrace(events)`, derive analyst findings from it, and feed them to `improve()` for a gated candidate.
Prove it offline: `pnpm tsx examples/intelligence-recommend/intelligence-recommend.ts` ($0, no credentials).

### Product agents

Instrument the production entrypoint — the HTTP route or worker handler, chat function, agent-framework run method, CLI command, or MCP server handler.
Do not instrument a parallel demo path and call it done; the trace must represent real user-facing behavior.

Minimum data per run: project id, run id, trace id, commit sha when available; model, provider, config hash; token usage and cost when available; tool calls and errors; outcome or score when available (`trace.recordOutcome(...)`, extra labels via `TraceMeta.labels`); artifacts or pointers, never raw secrets.

### Fail-closed rules

- No checks: no PR mode.
- No mutable surfaces: no generated code/prompt changes.
- No traces: no recommendations.
- No held-out gate: no "improved" claim.
- No real backend: no benchmark/eval claim.
- Telemetry unavailable: do not break production (best-effort export).
- Plane unavailable: run on the base surface (keep-last-known delivery).

### What is live today

- Wrap → trace → the OFF billing floor: provable offline for $0 (`examples/intelligence-drop-in` reads the exported span back).
- Trace → findings → gated improvement candidate: provable offline for $0 (`examples/intelligence-recommend`).
- Certified delivery + the capability resolver: shipped and covered by unit tests; the pull lane targets the deployed plane.
- The Recommend/PR/Loop client verbs: the fenced tail below.

## Implementation shape in this repo

The SDK is a thin layer over shipped primitives:

| SDK concept | Existing primitive |
|---|---|
| trace export | `createOtelExporter`, `buildLoopOtelSpans`, `flatOtelSpan` |
| eval provenance export | `exportEvalRuns` |
| production chat envelope | `handleChatTurn` |
| manifest and mutable surfaces | `defineAgent` |
| trace-to-finding loop | `runAnalystLoop` |
| code/tool/MCP candidate generation | `improvementDriver`, `agenticGenerator`, verifiers |
| loop execution | `runLoop` (kernel), `runAgentic` / `defineStrategy` (Supervisor), `createCoordinationTools` (agent-driver) |
| promotion | `promotionGate`, held-out gates in `@tangle-network/agent-eval` |

The wrapper lives at the `/intelligence` subpath:

```ts
import {
  composeCertifiedProfile,
  createCertifiedPromptSource,
  createIntelligenceClient,
  pullCertified,
  withCertifiedDelivery,
  withTangleIntelligence,
} from '@tangle-network/agent-runtime/intelligence'
```

The wrapper owns defaults and ergonomics; the substrate keeps owning traces, loops, gates, and candidate verification.

## Designed, not shipped

The upper-mode client verbs are design targets, not exports — nothing in this fence exists in the package today:

```ts
// DESIGN SKETCH — none of these exist yet.
const intelligence = createIntelligenceClient({
  project: 'support-agent',
  outcomes: { fromRun: (run) => ({ success: run.resolved, costUsd: run.costUsd }) }, // no `outcomes` field
})
await intelligence.flushRecommendations() // Recommend as a hosted verb
await intelligence.runImprovementCycle() // Gated-PR mode (config `mode: 'open-pr'`)
await intelligence.configureLoop({ budgetUsd: 25, candidates: 4, gate: { kind: 'paired-bootstrap' } })
defineImprovementSurface({ /* declarative mutable-surface registration */ })
```

What exists underneath each verb today:

- **flushRecommendations** — the substrate is `client.recordTrace(...)` → trace analysts → `improve()`, proven offline in `examples/intelligence-recommend`. Missing: the hosted verb that runs it as a service.
- **runImprovementCycle** — the readiness half ships as `IntelligenceClient.doctor()` (checks + surfaces + repo); the loop half ships as `improve()`, `improvementDriver`, `agenticGenerator`, and `promotionGate`. Missing: the client verb plus the repo plumbing (isolated branch/worktree, check runner, PR open).
- **configureLoop** — the loop grammar ships as `runLoop`, `runAgentic` / `defineStrategy`, and the held-out gates in `@tangle-network/agent-eval`. Missing: the config-object verb that maps a declarative gate/matrix onto them.
- **defineImprovementSurface** — mutable surfaces are declared today as the `surfaces` field of `IntelligenceConfig` (a readiness input only). Missing: a first-class registration a PR mode consumes.
