/**
 * The ADC substrate-swap spike: agent-dev-container's `pr-review-with-approval` workflow template
 * (products/platform/api/src/lib/workflow-templates.ts), hand-lowered to the `EngineGraphSpec`
 * its authoring compiler would emit. This is the proof that the engine can be the execution
 * substrate under ADC's workflow product while ADC keeps its front-end and business kinds:
 *
 *   - `agent.run`   → a METERED host kind over ADC's `runAgent` dep; its spend settles into the
 *                     one conserved pool, so ADC's `maxRunCostUsd` becomes `Budget.maxUsd`.
 *   - `decision`    → a host kind that parks: the node settles a `SuspensionRequest`, the human
 *                     answer arrives as `resume(token, payload)`, and ADC's `onTimeout: default`
 *                     maps to the suspension's `onExpire: 'default'`.
 *   - `${steps.x}`  → `data` edges; a single-field read is an edge projection, and a template
 *                     assembling several sources is a pure `script` node (agent-runtime#971).
 *   - `if:` guards  → the edge `guard` tree, which the engine adopted from ADC verbatim.
 *
 * The lowering targets the template's meaning, not its YAML: node ids keep ADC's positional
 * `step-N` names so `${steps[N]}` and the UI's `nodeId` column stay recognizable.
 */

import { contentAddress } from '../../../src/durable/content-address'
import { ValidationError } from '../../../src/errors'
import type {
  EngineGraphSpec,
  GraphNodeSettle,
  GraphRunResult,
  NodeKind,
} from '../../../src/runtime/graph'
import { suspended } from '../../../src/runtime/graph'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
} from '../../../src/runtime/supervise/types'

/** What ADC's `deps.runAgent` looks like to the lowered `agent.run` node. */
export interface AdcRunAgent {
  run(request: AgentRunRequest): Promise<AgentRunOutcome>
}

export interface AgentRunRequest {
  readonly profile: string
  readonly prompt: string
  readonly source: { readonly repo: string; readonly pr: number }
  readonly maxRounds: number
}

/** The slice of ADC's `RunAgentResult` the workflow surface reads. */
export interface AgentRunOutcome {
  readonly finalMessage: string
  readonly costUsd: number
  readonly inputTokens: number
  readonly outputTokens: number
}

export interface AgentRunKindConfig {
  readonly profile: string
  readonly maxRounds: number
}

export interface DecisionKindConfig {
  readonly title: string
  readonly options: ReadonlyArray<string>
  readonly timeoutMs: number
  /** ADC's `onTimeout: default` choice — the only offline-resolvable timeout policy. */
  readonly defaultChoice: string
}

function asRecord(raw: unknown, context: string): Readonly<Record<string, unknown>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError(`${context}: config must be an object`)
  }
  return raw as Readonly<Record<string, unknown>>
}

function requireString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${context}: ${key} must be a non-empty string`)
  }
  return value
}

function requirePositiveInt(
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): number {
  const value = record[key]
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ValidationError(`${context}: ${key} must be a positive integer`)
  }
  return value as number
}

/** A leaf whose body is host code and whose spend is REAL: metered into the conserved pool. */
function meteredLeaf(
  name: string,
  nodeKind: string,
  body: (
    signal: AbortSignal,
  ) => Promise<{ out: unknown; costUsd: number; inputTokens: number; outputTokens: number }>,
): Agent<unknown, unknown> & { executorSpec: AgentSpec } {
  let artifact: ExecutorResult<unknown> | undefined
  const executor: Executor<unknown> = {
    runtime: 'inline',
    async execute(_task, signal) {
      const { out, costUsd, inputTokens, outputTokens } = await body(signal)
      artifact = {
        outRef: contentAddress(out),
        out,
        spent: {
          iterations: 1,
          tokens: { input: inputTokens, output: outputTokens },
          usd: costUsd,
          ms: 0,
        },
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      if (!artifact)
        throw new ValidationError(`${nodeKind}: resultArtifact() read before execute()`)
      return artifact
    },
  }
  return {
    name,
    act: () => Promise.reject(new ValidationError(`${nodeKind}: act() is not the execution path`)),
    executorSpec: {
      profile: { name },
      harness: null,
      executor,
      execution: { correlation: { nodeKind } },
    },
  }
}

/** A budget-exempt leaf, for host code that spends nothing (the decision park). */
function exemptLeaf(
  name: string,
  nodeKind: string,
  body: () => Promise<unknown>,
): Agent<unknown, unknown> & { executorSpec: AgentSpec } {
  let artifact: ExecutorResult<unknown> | undefined
  const executor: Executor<unknown> = {
    runtime: 'inline',
    budgetExempt: true,
    async execute() {
      const out = await body()
      artifact = {
        outRef: contentAddress(out),
        out,
        spent: { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      if (!artifact)
        throw new ValidationError(`${nodeKind}: resultArtifact() read before execute()`)
      return artifact
    },
  }
  return {
    name,
    act: () => Promise.reject(new ValidationError(`${nodeKind}: act() is not the execution path`)),
    executorSpec: {
      profile: { name },
      harness: null,
      executor,
      execution: { correlation: { nodeKind } },
    },
  }
}

/** ADC's `agent.run`, lowered: one run through the host's `runAgent` dep, spend metered. */
export function adcAgentRunKind(): NodeKind<AgentRunKindConfig, readonly ['runAgent']> {
  return {
    id: 'adc.agent.run',
    version: 1,
    description: 'Run one ADC agent through the host runAgent dependency; spend is metered.',
    validateConfig: (raw, context) => {
      const record = asRecord(raw, context)
      return {
        profile: requireString(record, 'profile', context),
        maxRounds: requirePositiveInt(record, 'maxRounds', context),
      }
    },
    configSchema: {
      type: 'object',
      properties: { profile: { type: 'string' }, maxRounds: { type: 'number' } },
      required: ['profile', 'maxRounds'],
      additionalProperties: false,
    },
    inputs: [{ name: 'request', schema: { type: 'object' } }],
    outputs: [{ name: 'result', schema: { type: 'object' } }],
    effects: ['runAgent'] as const,
    onCrash: 'restart',
    budget: 'metered',
    run: ({ config, profile, inputs, effects }) =>
      meteredLeaf(profile.name ?? 'adc.agent.run', 'adc.agent.run/v1', async () => {
        const request = inputs.request as { prompt: string; source: { repo: string; pr: number } }
        const outcome = await (effects.runAgent as AdcRunAgent).run({
          profile: config.profile,
          prompt: request.prompt,
          source: request.source,
          maxRounds: config.maxRounds,
        })
        return {
          out: { finalMessage: outcome.finalMessage, costUsd: outcome.costUsd },
          costUsd: outcome.costUsd,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
        }
      }),
  }
}

/** ADC's `decision`, lowered: the node parks; a human answer is `resume(token, { choice })`. */
export function adcDecisionKind(): NodeKind<DecisionKindConfig> {
  return {
    id: 'adc.decision',
    version: 1,
    description: 'Park for a human choice; timeout resolves to the declared default.',
    validateConfig: (raw, context) => {
      const record = asRecord(raw, context)
      const options = record.options
      if (
        !Array.isArray(options) ||
        options.length < 2 ||
        options.some((option) => typeof option !== 'string' || option.length === 0)
      ) {
        throw new ValidationError(`${context}: options must be at least two non-empty strings`)
      }
      const defaultChoice = requireString(record, 'defaultChoice', context)
      if (!options.includes(defaultChoice)) {
        throw new ValidationError(`${context}: defaultChoice must be one of options`)
      }
      return {
        title: requireString(record, 'title', context),
        options: options as ReadonlyArray<string>,
        timeoutMs: requirePositiveInt(record, 'timeoutMs', context),
        defaultChoice,
      }
    },
    configSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        timeoutMs: { type: 'number' },
        defaultChoice: { type: 'string' },
      },
      required: ['title', 'options', 'timeoutMs', 'defaultChoice'],
      additionalProperties: false,
    },
    inputs: [{ name: 'prompt', schema: { type: 'string' } }],
    outputs: [{ name: 'resolution', schema: { type: 'object' } }],
    effects: [] as const,
    onCrash: 'restart',
    budget: 'exempt',
    run: ({ config, profile }) =>
      exemptLeaf(profile.name ?? 'adc.decision', 'adc.decision/v1', async () =>
        suspended({
          onExpire: 'default',
          expiresInMs: config.timeoutMs,
          default: { choice: config.defaultChoice, timedOut: true },
        }),
      ),
  }
}

/** The GitHub `pull_request: opened` trigger context the template consumes. */
export interface PrTrigger {
  readonly payload: {
    readonly pull_request: { readonly number: number; readonly title: string }
    readonly repository: {
      readonly full_name: string
      readonly name: string
      readonly owner: { readonly login: string }
    }
  }
}

/**
 * `pr-review-with-approval`, lowered. The `${...}` templates become two pure script nodes (the
 * compiler-emitted assemblies), the `if:` guard becomes the edge guard on the decision's data
 * edge, and the decision is a forced terminal so a rejected review completes the run cleanly
 * with the post skipped — ADC's semantics for a guarded-out step.
 */
export function lowerPrReviewWithApproval(trigger: PrTrigger): EngineGraphSpec {
  return {
    nodes: [
      {
        id: 'trigger',
        kind: 'script/v1',
        config: { body: () => trigger, pure: true },
      },
      {
        id: 'review-request',
        kind: 'script/v1',
        config: {
          body: (inputs: Record<string, unknown>) => {
            const context = inputs.trigger as PrTrigger
            return {
              prompt:
                `Review pull request #${context.payload.pull_request.number} ` +
                'and produce a complete structured review as your final output.',
              source: {
                repo: context.payload.repository.full_name,
                pr: context.payload.pull_request.number,
              },
            }
          },
          pure: true,
        },
        ports: { inputs: [{ name: 'trigger', schema: { type: 'object' } }] },
      },
      {
        id: 'step-1',
        kind: 'adc.agent.run/v1',
        config: { profile: 'code-reviewer', maxRounds: 3 },
      },
      {
        id: 'step-2',
        kind: 'adc.decision/v1',
        config: {
          title: 'Post this PR review?',
          options: ['approve', 'reject'],
          timeoutMs: 24 * 60 * 60 * 1000,
          defaultChoice: 'reject',
        },
        terminal: true,
        deliverable: {
          check: (out: unknown) => typeof (out as { choice?: unknown }).choice === 'string',
          describe: 'a resolved decision',
        },
      },
      {
        id: 'post-request',
        kind: 'script/v1',
        config: {
          body: (inputs: Record<string, unknown>) => {
            const context = inputs.trigger as PrTrigger
            const review = inputs.review as { finalMessage: string }
            return {
              owner: context.payload.repository.owner.login,
              repo: context.payload.repository.name,
              pull_number: context.payload.pull_request.number,
              event: 'COMMENT',
              body: review.finalMessage,
            }
          },
          pure: true,
        },
        ports: {
          inputs: [
            { name: 'trigger', schema: { type: 'object' } },
            { name: 'review', schema: { type: 'object' } },
            { name: 'approval', schema: { type: 'object' } },
          ],
        },
      },
      {
        id: 'step-3',
        kind: 'integration.invoke/v1',
        config: { connector: 'github', operation: 'pulls.reviews.create' },
        deliverable: {
          check: (out: unknown) => out !== undefined,
          describe: 'the posted review response',
        },
      },
    ],
    edges: [
      { kind: 'data', from: { node: 'trigger' }, to: { node: 'review-request', port: 'trigger' } },
      { kind: 'data', from: { node: 'review-request' }, to: { node: 'step-1', port: 'request' } },
      {
        kind: 'data',
        from: { node: 'step-1' },
        to: { node: 'step-2', port: 'prompt' },
        projection: { path: 'finalMessage' },
      },
      { kind: 'data', from: { node: 'trigger' }, to: { node: 'post-request', port: 'trigger' } },
      { kind: 'data', from: { node: 'step-1' }, to: { node: 'post-request', port: 'review' } },
      {
        kind: 'data',
        from: { node: 'step-2' },
        to: { node: 'post-request', port: 'approval' },
        guard: { path: 'out.choice', op: 'eq', value: 'approve' },
      },
      { kind: 'data', from: { node: 'post-request' }, to: { node: 'step-3', port: 'args' } },
    ],
  }
}

/** The row shape ADC's run detail UI reads (client/hooks/useWorkflowApi.ts), per template step. */
export interface AdcActionResult {
  readonly index: number
  readonly kind: string
  readonly nodeId: string
  readonly status: 'succeeded' | 'failed' | 'skipped' | 'waiting'
  readonly output?: unknown
  readonly costUsd?: number
}

const TEMPLATE_STEPS: ReadonlyArray<{ nodeId: string; kind: string }> = [
  { nodeId: 'step-1', kind: 'agent.run' },
  { nodeId: 'step-2', kind: 'decision' },
  { nodeId: 'step-3', kind: 'integration.invoke' },
]

/** Project an engine run onto ADC's `actionResults` — the substrate swap keeps the UI's shape. */
export function actionResultsFromRun(result: GraphRunResult): AdcActionResult[] {
  const byNode = new Map<string, GraphNodeSettle>()
  for (const settle of result.settles) byNode.set(settle.node, settle)
  const waiting = new Set(result.kind === 'suspended' ? result.tokens.map(() => 'step-2') : [])
  return TEMPLATE_STEPS.map((step, index) => {
    const settle = byNode.get(step.nodeId)
    if (!settle) {
      return {
        index,
        kind: step.kind,
        nodeId: step.nodeId,
        status: waiting.has(step.nodeId) ? ('waiting' as const) : ('skipped' as const),
      }
    }
    if (settle.status === 'down') {
      return { index, kind: step.kind, nodeId: step.nodeId, status: 'failed' as const }
    }
    const costUsd = (settle.out as { costUsd?: number } | undefined)?.costUsd
    return {
      index,
      kind: step.kind,
      nodeId: step.nodeId,
      status: 'succeeded' as const,
      output: settle.out,
      ...(typeof costUsd === 'number' ? { costUsd } : {}),
    }
  })
}
