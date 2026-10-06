# Improve an agent

`improve` runs a complete optimization method against a profile surface, including the entire profile.
The method owns candidate generation and selection.
Runtime keeps the final test set out of the method and scores the baseline and selected candidate on it.
It returns `ship` only when Eval permits promotion, the deciding interval clears `minimumLift`, and cost accounting is complete.
Eval's decision includes the registered effect, independent observation count, interval validity, and applicable exact-test checks.
An inconclusive result retains the selected candidate and the full decision in `result.raw.best.decision`.

The existing options accept Eval's optional `claim` and `finalEvidence` through both improvement paths.
Method reports retain them in `result.raw`, including source-unit counts and final exposure records.
See [Eval's evaluation-integrity guide](https://github.com/tangle-network/agent-eval/blob/main/docs/evaluation-integrity.md) for their scope and host responsibilities.
These controls do not grant product activation authority.
The profile is never changed.

The runnable offline paths are [`examples/improve/improve.ts`](../examples/improve/improve.ts) for a complete method and [`examples/improve/search.ts`](../examples/improve/search.ts) for the native search.
This page is the reference for the production path.

## Compose analysis and search

`observe` and `harvestCorpus` accept an `analysis` callback through the existing findings, usage, and corpus contracts.
`observationFromRegistry` adapts an Eval `AnalystRegistry`, including registered trace engines, recursive analysts, custom inputs, budgets, and ordered analysis.
The adapter receives the complete input; the default observer's context limits do not truncate registry input.
Use its `record` callback to retain the complete analyst result and cost receipts.
Failed analysis retains measured token subtotals through `ObservationError` and `HarvestError.report`.

```ts
import { harvestCorpus, observationFromRegistry } from '@tangle-network/agent-runtime/kernel'

const report = await harvestCorpus({
  runs, corpus,
  analysis: observationFromRegistry(registry, {
    inputs: toAnalystInputs,
    proposalOrigin: 'search',
    runOptions: { chainFindings: true, budget: { totalUsd: 5 } },
    record: saveAnalystResult,
  }),
})
```

Select analysts and their engines in Eval's registry; Runtime does not maintain another engine catalog.
Without `analysis`, supply the observer profile and executor, plus optional `maxTraceLines`, `maxOutputChars`, and `proposalOrigin`.
Injected findings keep their evidence references and judge-derived status.
For default analysis, supply `ObserveInput.evidenceRefs` to identify the retained trace and output used by the findings.
Final acceptance still uses the independent final-test partition.

Eval's `scopedOptimizationMethod` evaluates a projected mutation inside its complete candidate.
`sequentialOptimizationMethod` passes each selected candidate directly to the next method, without requiring intermediate promotion.
Both return the existing `OptimizationMethod`, so they can be passed to `improve` or compared through `compareOptimizationMethods`.
Use the latter for parallel alternatives or arbitrary JSON candidates representing a complete learning procedure.
The consumer's execution callback determines how candidate fields affect execution.
Keep that callback and its dependencies bound to the execution identity.

Composed method evidence remains in `result.raw.best.composition.stages`, including each child's provenance, usage, history, and selected surface.
Read the aggregate cost from `result.cost`; summing it with child costs would count the same work twice.
A method that records a search ledger must close it; Runtime replays the ledger bytes and returns the receipt as `result.searchHistory`.

## The call

```ts
import { improve, officialGepa } from '@tangle-network/agent-runtime'
import { profileOptimizerModelCall } from '@tangle-network/agent-runtime/kernel'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'

const executionRef = canonicalCandidateDigest({
  deployment: process.env.AGENT_DEPLOYMENT_SHA!,
  model: process.env.AGENT_MODEL!,
  tools: process.env.AGENT_TOOLSET_SHA!,
})

const result = await improve(baseProfile, {
  surface: 'prompt',
  executionRef,
  method: officialGepa({
    objective: 'Improve the complete support-agent prompt.',
    recipe: { kind: 'engine', run: { engine: 'gepa', maxEvaluations: 40, maxProposerCostUsd: 10 } },
    optimizer,
    resume: 'if-compatible',
    trustResumeState: true,
    describeScenario: ({ input }) => ({ input }),
  }),
  findings,
  trainScenarios,
  selectionScenarios,
  testScenarios,
  judges: [judge],
  agent: (candidateProfile, scenario, ctx) => runProfile(candidateProfile, scenario, ctx),
  runDir: '.runs/support-prompt',
  costCeiling: 25,
})

if (result.decision === 'ship') console.log(result.candidate.profile, result.liftInterval)
```

## The optimizer object

SkillOpt and GEPA's standard reflection engine require `optimizer: { model, call, callRef, budget }`.
Agent-based GEPA engines may own their model connection instead.
Runtime owns those model calls through one exact `AgentProfile`.
Agent Eval enforces the nested budget and records the measured cost and execution evidence without receiving provider credentials.

```ts
const optimizerProfile = {
  name: 'support-prompt-optimizer',
  harness: 'cli-base',
  model: {
    provider: 'tangle-router',
    default: process.env.OPTIMIZER_MODEL!,
    maxVisibleOutputTokens: 16_384,
  },
} satisfies AgentProfile

const optimizerPricing = {
  inputUsdPerMillion: Number(process.env.OPTIMIZER_INPUT_USD_PER_MILLION),
  outputUsdPerMillion: Number(process.env.OPTIMIZER_OUTPUT_USD_PER_MILLION),
}

const optimizer = {
  model: optimizerProfile.model.default,
  call: profileOptimizerModelCall({
    profile: optimizerProfile,
    context: 'support-prompt optimizer',
    executor: {
      backend: 'router',
      routerBaseUrl: process.env.OPTIMIZER_BASE_URL!,
      routerKey: process.env.OPTIMIZER_API_KEY!,
    },
    pricing: optimizerPricing,
  }),
  callRef: canonicalCandidateDigest({
    profile: canonicalAgentProfileDigest(optimizerProfile),
    deployment: process.env.OPTIMIZER_DEPLOYMENT_SHA!,
  }),
  budget: {
    maxCostUsd: 10,
    maxRequests: 50,
    maxRequestBytes: 2_000_000,
    maxResponseBytes: 2_000_000,
    maxOutputTokensPerRequest: 16_384,
    pricing: optimizerPricing,
  },
}
```

`costCeiling` is the total limit for optimizer calls, candidate runs, judges, and final scoring.
Runtime returns `hold` when any part of that cost is unknown.
A native search is the exception for calls whose cost is unknown under a maximum they declared before running (see [Native search](#native-search)).
Runtime rejects a reported total above the limit.

## Official optimizers

`officialGepa(...)` delegates the complete search to GEPA's upstream Optimize Anything API through agent-eval.
Pass one explicit `engine`, `sequential`, `adaptive-sequential`, `best-of`, `vote`, or `omni` recipe.
There is no local fallback.
Install its optional Python process first:

```bash
python -m pip install "agent-eval-rpc==0.198.0"
python -m pip install "gepa[full]==0.1.4"
```

The published GEPA 0.1.4 wheel supports the direct `gepa` engine.
Sequential, adaptive, best-of, vote, Omni, AutoResearch, Meta Harness, and Best-of-N require the tested official source revision:

```bash
python -m pip install "gepa[full] @ git+https://github.com/gepa-ai/gepa.git@f919db0a622e2e9f9204779b81fe00cc1b2d808f"
```

Use `officialSkillOpt(...)` for Microsoft's SkillOpt:

```bash
python -m pip install "agent-eval-rpc==0.198.0"
python -m pip install "skillopt @ git+https://github.com/microsoft/SkillOpt.git@61735e3922efc2b90c6d6cab561e62e98452ca90"
```

SkillOpt 0.2.0's published wheel omits prompt files that `ReflACTTrainer` requires, so the tested SkillOpt source revision stays necessary.

### Resume and provenance

Runtime derives the upstream resume identity from `executionRef`, the complete baseline profile, and the selected surface.
With `resume: 'if-compatible'`, agent-eval resumes only when the saved run identity matches the candidate, recipe, data, optimizer settings, runner, and derived execution identity.
Set `trustResumeState: true` only when that run directory is private to the current operator.
Use `resume: 'required'` to fail when no matching run exists.

`result.provenance` reports the upstream package, run ID, resume status, evaluation count, and artifact directory.
`result.searchHistory` is the optimizer's search ledger, closed and verified from its bytes.
`officialGepa` and `officialSkillOpt` always record one at `<runDir>/search-ledger.jsonl`.
Every candidate the evaluation callback scored is a node, and every evaluation is an `external` cell.
GEPA's reported parents become `correlated` edges; SkillOpt reports no parents, so its edges are `unknown`.
The optimizer's own choice is the `selected` node.
A custom method that records no ledger returns `searchHistory: null`, which means its lineage is unknown.
`lineage.baselineProfileDigest` is `canonicalAgentProfileDigest` of the baseline: the same identity supervise, preparation receipts, and VerticalBench record.
Ship the ledger to Intelligence with Eval's `startSearchShipper` or `agent-eval search ship`.

## Native search

`searchMethod(...)` runs Runtime's own profile search on Eval's search kernel, with no Python process.
A policy chooses which node each proposal extends, an allocator chooses where cells run, and your proposer writes each child surface.
Each node is an exact AgentProfile, addressed by `canonicalAgentProfileDigest`.
Each edge stores the Interface diffs from the parent profile to the child; Runtime stores the diffs only when they reproduce the child.
Each cell is a one-cell `runCampaign` of the node's profile on one task, on one lane.

```ts
import { dedicatedLane, improve, searchMethod } from '@tangle-network/agent-runtime'

const result = await improve(baseProfile, {
  executionRef,
  method: searchMethod({
    proposer,
    maxExpansions: 20,
    lanes: [dedicatedLane({ capacity: 8, cellUsd: 0.05 })],
  }),
  claim, // an EvaluationClaim: independentUnit names each scenario's unit field; minimumEffect is required
  trainScenarios,
  selectionScenarios,
  testScenarios,
  judges,
  agent,
  costCeiling: 40,
  runDir,
})
```

The proposer is a `SurfaceProposer`.
For a profile's text surfaces (a system prompt, instructions, a skill, or named text components), use Runtime's `reflectiveProfileProposer`:

```ts
import { reflectiveProfileProposer } from '@tangle-network/agent-runtime'

const proposer = reflectiveProfileProposer({
  model: 'deepseek/deepseek-v4.1-flash',
  chat: ({ messages, maxOutputTokens, callId, signal }) => callRouter(messages, maxOutputTokens, callId, signal),
  pricing: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 1.2 },
  frame: 'You improve the system prompt of an analyst agent scored against published answers.',
  evidence: ({ surface, trainCells }) => trainArtifactsBesideTruth(surface, trainCells),
})
```

Each proposal is one call under `optimizerMethod`: the model reads the parents the policy chose, their train cells, your `evidence` for each parent, and the search's train summary, and returns one complete replacement surface with a label and a hypothesis.
`evidence` is your train-only view of the parent's artifacts, such as each train task's expected answer beside the parent's answer; it must never read selection or test data.
`chat` makes the call with your client; forward `callId` as the provider's idempotency key and return the reply text and the billed tokens, or `usage: null` when the provider reported none.
Runtime runs it as a paid call on the proposal's cost ledger with a declared maximum (every prompt byte as a token plus `maxOutputTokens`, at `pricing`), so a failed call counts at that bound.
A reply without a usable surface proposes nothing.

The defaults are Eval's `aide()` policy and `asha()` allocator.
`aide()` drafts 5 alternatives from the baseline, then debugs a node whose cells fail as defects or improves a parent drawn by Thompson sampling over each node's posterior.
A lineage whose improvements stop raising its best posterior mean forks from the best node.
`asha()` screens each node on 6 selection units and 2 train units, and advances the top third of each rung to twice the units.
Pass `policy: beam({ width })` to expand the top nodes in turn.
Pass `policy: incumbent()` with `allocation: uniform()` for the hill climb, which runs every node on every train and selection task.
The hill climb needs `uniform()`: under `asha()` it keeps the root until a child finishes the top rung.
The proposer receives the parents, the train view and a train summary; it never sees selection or test scores.
Read `ctx.train` before the proposer's first `await`: the view retires when the ledger moves on.
Runtime refuses a candidate that does not materialize, declares training on a test task, fails your validator, or carries a credential or private value.
A refused candidate stays in the ledger as an invalid node.

The claim is made once, on the sealed test split, by the kernel.
It runs the power check, tests at most 3 finalists against the root at Bonferroni confidence, and records the result as `result.claim`.
`result.decision` is `ship` only when the claim shipped, the claim re-derives from the ledger, the cost accounting is complete or bounded within `costCeiling`, and the shipped finalist's test lower bound exceeds `minimumLift`.
Otherwise `result.reason` says which rule held it.
`result.candidate` is the claim's selection, or the baseline when nothing shipped.
`result.searchHistory` is the closed ledger.

A call that ends with no receipt, such as a request that failed in transit, leaves its cost unknown.
When every such call declared a priced maximum before it ran, `result.cost.costBound` counts each at that maximum: `unknownCalls`, `unknownMaximumUsd`, and `totalMaximumUsd`, the most the search can have cost.
The search ships when that total fits `costCeiling`, and `result.reason` states the bound.
A call of unknown cost with no declared maximum, unknown usage on a priced call, or a call above its own maximum still holds the search.

When the search ships, `result.promotion` is `{ experiment, decision }`, ready for a [profiles table](canonical-api.md) entry beside the shipped profile:

```ts
const entry: SuperviseProfileEntry = { profile: result.candidate.profile, promotion: result.promotion! }
```

The sealed experiment names the root as control and every finalist the claim tested as a treatment, each by its exact profile digest; the claim fixed those arms before any test cell ran.
Its seal is dated by the search's close, so one ledger always yields one promotion.
The decision is Eval's `searchClaimDecision`: the paired decision the claim made for the shipped finalist, made again from the ledger.
An entry needs `profile.name` equal to its table name, and the shipped profile carries the baseline's name, so list it under that name rather than renaming it: a renamed profile has another digest, which no arm names.

The ledger is the only checkpoint.
Call `improve()` again with the same inputs to continue an interrupted search; a closed search returns without running anything, decided under the current ship rule.
`decideSearchImprovement({ searchDir })` decides a closed search from its directory alone, with no model call: pass the `minimumLift` it ran with, and `costLedger` when `improve()` was given one.
It returns the decision, the reason, the cost, the promotion, and the baseline and kept profiles.
The ship rule is not part of a search's identity, so a search an earlier rule held is decided again rather than run again.

### Lanes

A lane is where cells run and under which cost rule.
The search runs at most the lanes' total capacity at once, and each cell goes to a lane that accepts the node's profile, in proportion to capacity.
A candidate that no lane accepts is refused before it runs.

| Lane | Capacity | Cost rule |
|---|---|---|
| `sharedBoxLane({ client, boxes, cellUsd })` | `boxes × workersPerBox` (8 by default) | Estimate. The box's workers share one router key, which caps no single worker. The placement refuses a profile it cannot carry, such as MCP servers, hooks, subagents or a replaced system prompt. |
| `dedicatedLane({ capacity, cellUsd })` | `capacity` | Estimate: `cellUsd` until 20 cells settle, then 1.5 × the p99 of the lane's settled cells. Overshoot is recorded. |
| `subscriptionLane({ seats, cellUsd? })` | `seats` | Hard. The seat charges no dollar and reports no tokens, so the cell's tokens are unknown. `cellUsd` bounds its priced calls, such as judges. |
| `routerLane({ capacity, cellUsd })` | `capacity` | Hard. `cellUsd` is each cell's maximum. |

On a hard lane every paid call of a cell, the agent's and the judges', must declare a priced `maximumCharge`.
Runtime refuses a call that declares none, or that would take the cell past `cellUsd`, so the kernel's hard reservation is a bound.
A shared-box agent reaches its box through `lane.placement.providerFor({ nodeId: ctx.search.runId })`, which names the attempt to the router on every call.

The agent receives `ctx.search`: the attempt's lane, run id, node, task and trace.
`ctx.search.runId` is `cellId:attempt`, and it is the same after a restart.
Key remote work by it, so a request sent again returns the first execution's result instead of running a second.
Throw `SearchEnvironmentFault` when the environment, not the profile, ended the run.
The attempt then settles `errored` and retryable, and the kernel runs a fresh attempt, up to `maxAttempts`.
A transient platform failure (a 502, 503 or 504, a dropped connection) counts as an environment fault too.

Runtime records every finished attempt under its run id before the kernel settles it.
A search restarted after a crash adopts a finished attempt instead of running it again.

Every paid call a search makes is tagged with the search and with the attempt or proposal that made it.
An attempt's cost is every call tagged with its run id, including calls a killed process made for the same attempt.
A process killed during a paid call leaves that call pending, and the cost ledger refuses new paid work while one is unresolved.
A reopened search therefore settles its interrupted calls before it runs anything.
A lane built with `recoverReceipt(call)` asks its provider what `call.callId` was billed; forward the call id your paid call's `execute` receives as the provider's idempotency key.
Without `recoverReceipt`, or when the provider cannot answer, the call settles failed with an unknown cost, and the search reports its accounting incomplete.

Several searches in one process can share two fleet bounds, both from `@tangle-network/agent-runtime/kernel`:

- `workerSlots: createWorkerSlots(n)` bounds working cells across every search that passes it; a cell waits for a slot, and the wait is its `queueMs`.
- `budgetPool: createBudgetPool({ maxUsd, maxTokens, maxIterations }, Date.now())` holds fleet dollars: a cell on a hard lane reserves its lane's `cellUsd` before it starts, waits while running cells could return enough, and settles with its measured spend.
  Estimate lanes take no ticket, because they cannot bound a cell.
  A refused reservation stops the search.

Each attempt is one trace.
Its root span, `search.cell`, carries `agent.branch.id` = the node id, and the campaign's spans are its children.
Spans go to `<search dir>/spans.otlp.jsonl` by default; pass `trace: { otlp }` for a collector, or `trace: 'off'`.
The cell's `traceRef` records the trace id and the spans the exporter wrote and dropped for that attempt.

## Surfaces

SkillOpt accepts one text surface.
GEPA accepts text or named components.
Any complete method from `@tangle-network/agent-eval` uses the same call.

- For a skill, set `surface: 'skills'` and `skills.resourceName`.
- For the complete profile, set `surface: 'agent-profile'`.
- To optimize several named profile fields together, also provide `profileComponents.read` and `profileComponents.apply`.

Tools, MCP, hooks, subagents, curated instructions, and rollout policy are also exact profile coordinates.
Runtime does not choose an optimizer for them.

The `agent` callback receives the complete immutable candidate profile, not a raw prompt or a component fragment.
Runtime uses that exact profile for every candidate run and returns the same measured profile in `result.candidate.profile`.
`executionRef` is a content digest of the agent callback, profile component mapping, model, tools, and closure settings.
Runtime combines it with the complete baseline profile and the selected surface for saved work.
A change to any of them runs the affected work again.

Code is the exception.
It uses Runtime's isolated git worktrees and coding-agent candidate execution:

```ts
const result = await improve({
  surface: 'code',
  code: { repoRoot, baseRef, profile, generator },
  scenarios,
  judge,
  agent,
  budget,
})
```

## What leaves your process

Without `describeScenario`, the external optimizer receives only each development case ID.
Without `describeArtifact`, evaluation feedback contains no artifact body.
When either descriptor is present, its result passes through `redact` together with findings, background text, profile name, and judge notes.
The built-in redactor removes common credentials and email addresses.
Supply a domain redactor for customer names, account IDs, or other private data the built-in rules cannot identify.
Runtime applies that hook first and then still applies its built-in scrubber.
Set `redact: false` only when every outbound value is public and already reviewed.

The selected profile surface is the optimizer's candidate and cannot be redacted without changing the measured candidate.
Runtime always rejects recognized credentials in those bytes.
It also rejects structurally sensitive fields such as MCP env, headers, URLs, metadata, and extensions.
For `tools`, `mcp`, `hooks`, `subagents`, and `agent-profile`, Runtime treats the entire selected coordinate as execution-capable.
Use `authorizeSensitiveCandidate` to inspect and accept each exact immutable profile that contains public values or safe references.
The callback runs for the baseline and every distinct candidate before either reaches your agent.
Its `sensitivePaths` includes `$` when the whole coordinate requires review.

## From search to production

`improve` is the search call.
For production, `proposeAgentImprovement` adds trace analysis and reruns the exact frozen baseline and winner before it creates a reviewable proposal.
Runtime rejects a candidate bundle that differs from the search winner.

```ts
import {
  createAgentImprovementActivation,
  executeAgentImprovementActivation,
  proposeAgentImprovement,
  reviewAgentImprovementProposal,
} from '@tangle-network/agent-runtime/intelligence'

const baseline = freezeBaseline(liveProfile)
const result = await proposeAgentImprovement({
  runId,
  profile: liveProfile,
  analysis,
  improvement: {
    surface: 'prompt',
    executionRef,
    method,
    trainScenarios,
    selectionScenarios,
    testScenarios,
    judges: [judge],
    agent,
  },
  buildExperiment: ({ improvement }) =>
    buildExperimentMaterial({
      baseline,
      candidate: compileCandidateBundle({ baseline, improvement: improvement.candidate }),
      benchmark: heldOutBenchmark,
      policy: comparisonPolicy,
    }),
  placeCell,
})

const review = reviewAgentImprovementProposal(result.proposal, {
  decision: 'approve',
  reviewedBy: user.id,
  reason: 'The measured gain is worth the cost.',
})
const activation = createAgentImprovementActivation(result.proposal, review, {
  intent: 'activate-candidate',
  targets: [{ surface: 'prompt', identity: profileId }],
  fundingOwner: tenantId,
  authorizedBy: user.id,
  expiresAt,
})
const outcome = await executeAgentImprovementActivation(
  { proposal: result.proposal, review, activation },
  { transition: commitProfileTransaction, reconcile: readCommittedResult },
)
```

`buildExperimentMaterial`, `placeCell`, and the transaction functions are application ports, because storage and compute differ by product.
The builder returns only baseline, candidate, tasks, and policy; Runtime adds the search ancestry and seals the final experiment.
Runtime owns candidate identity, measurement, review binding, expiry, retry identity, and result validation; the application owns its atomic write.
Official optimizer proposals carry the observed package versions, the optimizer model, evaluation and token usage, separate optimization and final-test costs, and the resumed-run identity.
`createOptimizationActivationReceipt(result)` exposes the same detached record for a caller that must inspect an `improve()` result before it builds a proposal.

## Improve a knowledge base

`runKnowledgeImprovementJob` runs KB, wiki, memory-backed, and RAG improvement jobs.
It creates a candidate copy, runs agents against it, checks it through `@tangle-network/agent-knowledge`, and returns frozen baseline and candidate snapshots with spend and timing.
It never changes the live knowledge base.

Use `improve(profile, { surface: 'memory', ... })` for the agent's curated lesson document.
Use this job for source, retrieval, and knowledge-store changes.

```ts
import { runKnowledgeImprovementJob } from '@tangle-network/agent-runtime'

const result = await runKnowledgeImprovementJob({
  root: './kb',
  goal: 'Improve support refund-policy knowledge',
  implementationRef: 'git:0123456789abcdef0123456789abcdef01234567',
  readinessSpecs,
  budget: { maxIterations: 8, maxTokens: 120_000, maxUsd: 10 },
  backend,
})

console.log(result.knowledge?.reference.candidateHash, result.measurement.supervisedSpent)
```

Set `implementationRef` to the deployed `git:<40 hex>` revision, or to a `sha256:<64 hex>` digest that covers every callback, model, index, and external setting that can change the result.
The same run ID resumes only when this identity still matches.
Measure the returned bundle pair, record the review, then activate through `executeAgentImprovementActivation`.
Activation is the only write path.
