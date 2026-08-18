# Improve an agent

`improve` runs one complete optimization method against one profile field.
The method owns candidate generation and selection.
Runtime keeps the final test set out of the method, scores the baseline and the selected candidate on it, and returns `ship` only when the paired confidence interval clears `minimumLift`.
The profile is never changed.

The runnable offline path is [`examples/improve`](../examples/improve).
This page is the reference for the production path.

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
    metadata: { maxTokens: 16_384 },
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
Runtime rejects a reported total above the limit.

## Official optimizers

`officialGepa(...)` delegates the complete search to GEPA's upstream Optimize Anything API through agent-eval.
Pass one explicit `engine`, `sequential`, `adaptive-sequential`, `best-of`, `vote`, or `omni` recipe.
There is no local fallback.
Install its optional Python process first:

```bash
python -m pip install "agent-eval-rpc==0.145.0"
python -m pip install "gepa[full]==0.1.4"
```

The published GEPA 0.1.4 wheel supports the direct `gepa` engine.
Sequential, adaptive, best-of, vote, Omni, AutoResearch, Meta Harness, and Best-of-N require the tested official source revision:

```bash
python -m pip install "gepa[full] @ git+https://github.com/gepa-ai/gepa.git@f919db0a622e2e9f9204779b81fe00cc1b2d808f"
```

Use `officialSkillOpt(...)` for Microsoft's SkillOpt:

```bash
python -m pip install "agent-eval-rpc==0.145.0"
python -m pip install "skillopt @ git+https://github.com/microsoft/SkillOpt.git@61735e3922efc2b90c6d6cab561e62e98452ca90"
```

SkillOpt 0.2.0's published wheel omits prompt files that `ReflACTTrainer` requires, so the tested SkillOpt source revision stays necessary.

### Resume and provenance

Runtime derives the upstream resume identity from `executionRef`, the complete baseline profile, and the selected surface.
With `resume: 'if-compatible'`, agent-eval resumes only when the saved run identity matches the candidate, recipe, data, optimizer settings, runner, and derived execution identity.
Set `trustResumeState: true` only when that run directory is private to the current operator.
Use `resume: 'required'` to fail when no matching run exists.

`result.provenance` reports the upstream package, run ID, resume status, evaluation count, and artifact directory.
`result.candidatePopulation` verifies and joins callback observations with an optimizer's official candidate graph.
It returns every unique candidate as a complete profile with ordered Interface diffs, or as an explicit materialization refusal.
GEPA candidates keep exact parent indices and selection scores; callback-only proposals report lineage as unavailable.
Methods without either artifact return `status: 'unavailable'` instead of treating the winner as the full population.

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

A candidate does not need optimizer lineage.
When a person or a supervisor authors a complete profile by hand, `proposeAuthoredAgentProfileImprovement` admits it to the same path: the authored profile is measured against the frozen baseline on the sealed experiment, and the proposal, review, and activation steps are identical.
There is no separate trust track for hand-authored changes — authored and optimizer-produced candidates face the same gate.

## Improve a knowledge base

`runKnowledgeImprovementJob` runs KB, wiki, memory-backed, and RAG improvement jobs.
It creates a candidate copy, runs agents against it, checks it through `@tangle-network/agent-knowledge`, and returns frozen baseline and candidate snapshots with spend and timing.
It never changes the live knowledge base.

Use `improve(profile, { surface: 'memory', ... })` for the agent's curated lesson document.
Use this job for source, retrieval, and knowledge-store changes.

```ts
import { runKnowledgeImprovementJob } from '@tangle-network/agent-runtime/knowledge'

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
