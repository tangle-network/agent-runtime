# Jev without another runtime

Jev belongs in a bounded decision, judge, or analyst callback. Runtime already owns
execution, graph scheduling, continuation, journals, and budgets. Do not add a
`JevAgent`, a second graph runner, or another critique/revise loop.

## Graphs: use the existing registry adapter

After the Eval change that publishes `@tangle-network/agent-eval/jev`, construct an
ordinary `jevAnalyst` and register it in the existing Eval registry. Then use
`analystsFromRegistry` to attach it to an `analyzes` edge. The application owns the
scoped native transport, trace selection/redaction, findings, and paid-call account.

```ts
import { AnalystRegistry } from '@tangle-network/agent-eval/analyst'
import { jevAnalyst } from '@tangle-network/agent-eval/jev'
import {
  analystsFromRegistry,
  promptHandle,
  runGraph,
} from '@tangle-network/agent-runtime/kernel'

const registry = new AnalystRegistry({
  hooks: {
    // Retain failed/skipped summaries and usage, not only the returned findings.
    onAfterAnalyze: persistAnalystSummary,
  },
})

registry.register(jevAnalyst({
  id: 'evidence-review',
  description: 'Assess supplied execution evidence against the task requirements',
  inputKind: 'trace-store',
  model: pinnedJevModel,
  version: policyVersion,
  questions: reviewQuestions,
  evaluate: nativeEvaluation, // Router /v1/systemone; single accounted attempt.
  renderState: renderAuthorizedTraceEvidence,
  findings: mapAnswersToEvidenceBackedFindings,
  maximumCharge: enforcedMaximumCharge,
  receipt: readNativeReceipt,
}))

const graph = {
  nodes: [
    { id: 'driver', profile: driverProfile },
    { id: 'worker', profile: workerProfile },
  ],
  edges: [
    {
      kind: 'delegates' as const,
      from: 'driver', to: 'worker',
      directive: promptHandle('delegates/worker-brief/v1'),
      continuity: 'resume' as const,
      maxTraversals: authorizedTraversalLimit,
    },
    {
      kind: 'analyzes' as const,
      analyst: 'evidence-review', over: ['worker'], to: 'driver',
      directive: promptHandle('analyzes/findings-report/v1'),
    },
  ],
  budget: authorizedBudget,
  deliverable: independentCompletionCheck,
}

const result = await runGraph(graph, {
  ...executionOptions,
  analysts: analystsFromRegistry(registry, [{
    id: 'evidence-review', description: 'Review execution evidence', area: 'verification',
  }], { runOpts: {
    signal,
    costLedger: sharedCostLedger,
    costPhase: 'graph-review',
  } }),
})
```

The named values above are caller-owned domain/execution configuration, not hidden
defaults. Use real span/event/artifact references in findings. A probability-like
answer is a model judgment, not a causal diagnosis or a demonstrated calibration.
Do not reveal final-test rubrics to workers through review feedback.

`runGraph` keeps node pinning, versioned directives, traversal caps, resume semantics,
and edge-delivery evidence. A function-shaped analyst does not become free: its
native call must use the shared paid-call ledger with a genuine enforced bound.
Do not assume a separate analyst ledger automatically debits the Supervisor's token
pool. Allocate explicit analyst authority and reconcile its receipts in the total
experiment account; where one Supervisor pool must own every call, use the existing
metered agent-analyst path rather than hiding inference inside a supposedly pure lens.

The registry isolates analyst failures; its findings list alone is not proof of a
successful analysis. Persist and inspect the existing summaries. A failed optional
review must not be interpreted as a clean bill of health or an authorization to act.

## Before and after local inference

Use the actual call boundaries, not a new hook bus:

- `ToolLoopHooks.beforeTurn` is awaited and can prepare the conversation. It runs
  **before** the existing compaction step.
- `ToolLoopCompaction.distill` owns compaction at a clean tool-call boundary. Do not
  add a second compactor or orphan tool requests from their results.
- A caller-owned `ToolLoopChat` can prepare the final outgoing request and inspect
  the completed result. Preserve the provided signal, call/correlation identity,
  tool grants, served-model evidence, and all physical-attempt receipts.
- `RuntimeHooks` is observation-only. Its notifier does not await a required model
  decision and deliberately isolates observer errors. Use a durable sink/queue for
  analysis that must survive coordinator termination.

A normal awaited composition is enough:

```ts
const brain: ToolLoopChat = async (messages, tools, context) => {
  context?.signal.throwIfAborted()
  const prepared = await prepareAllowedContext(messages, context)
  context?.signal.throwIfAborted()
  const response = await modelCall(prepared, tools, context)
  await inspectCompletedResponse(response, context)
  return response
}
```

This is an ordering example, not a complete metering wrapper. When preparation or
inspection calls Jev, admit those calls through the shared paid-call account and
preserve their receipts even if a later operation fails. Do not return only the
main model's usage and call the entire program measured. Do not hide paid work in
an observer. Optional optimization failures should preserve the ordinary agent path;
authorization and irreversible actions remain deterministic controls.

A blocking output policy must run before delivery. It cannot retract streamed text
or undo completed tool effects. Prefer explicit generation → evaluation → revision
composition over silently rewriting a user's answer after it has been delivered.

## Sandbox coverage

A sandbox prompt may contain many native model requests. Session preparation is not
a portable barrier before each request inside Claude Code, Codex, or another external
harness. Use the substrate's supported native hooks and document their actual scope.
Do not add a misleading universal `beforeInference` flag to `agent-provider-tangle`.

## Optimization

The new Eval judge returns the existing `JudgeConfig`, so current campaigns and
`improve()` remain the path for comparing prompt variants, questions, rubric levels,
context policies, and output-selection policies. Keep train, selection, and final-test
partitions separate, and retain exact candidate/model versions plus all inner costs.
Jev selects/evaluates bounded options; generative models still produce arbitrary
arguments, code, summaries, and prompt rewrites.

## Verification and dependencies

`tests/kernel/jev-composition.test.ts` exercises the existing registry/graph and local
call ordering with deterministic injected responses. It is not a live Jev benchmark.
No new Runtime dependency or public orchestration primitive is needed. Production
consumers need the released Eval adapter and the native Router endpoint; do not
claim support merely because an unpublished import appears in a snippet.

Related changes: agent-eval #761, tangle-router #531, agent-dev-container #7620.
