/**
 * Two of agent-dev-container's platform-only node kinds, written as engine `NodeKind`s against a
 * fake host. This is the generality proof for agent-runtime#969: a consumer registers these beside
 * the core kinds and the engine source never names them (`generality.test.ts` greps for it).
 *
 * Each kind receives exactly the one host effect it declares, and runs as a leaf `Agent` carrying a
 * verbatim executor — no harness, no model, and budget-exempt, since neither spends tokens.
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { contentAddress } from '../../../src/durable/content-address'
import { ValidationError } from '../../../src/errors'
import type { NodeKind } from '../../../src/runtime/graph'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
} from '../../../src/runtime/supervise/types'

/** What the platform's integrations effect looks like to a node. */
export interface FakeIntegrations {
  invoke(
    connector: string,
    operation: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown>
}

/** What the platform's notifier effect looks like to a node. */
export interface FakeNotifier {
  send(channel: string, message: string): Promise<void>
}

export interface IntegrationInvokeConfig {
  readonly connector: string
  readonly operation: string
}

export interface NotifyConfig {
  readonly channel: string
  readonly template: string
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

function asRecord(raw: unknown, context: string): Readonly<Record<string, unknown>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError(`${context}: config must be an object`)
  }
  return raw as Readonly<Record<string, unknown>>
}

const ZERO = { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }

/** A leaf whose body is host code: verbatim, exempt, content-addressed, identified by its kind. */
function hostLeaf(
  profile: AgentProfile,
  nodeKind: string,
  body: (signal: AbortSignal) => Promise<unknown>,
): Agent<unknown, unknown> & { executorSpec: AgentSpec } {
  let artifact: ExecutorResult<unknown> | undefined
  const executor: Executor<unknown> = {
    runtime: 'inline',
    budgetExempt: true,
    async execute(_task, signal) {
      const out = await body(signal)
      artifact = { outRef: contentAddress(out), out, spent: ZERO }
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
    name: profile.name ?? nodeKind,
    act: () => Promise.reject(new ValidationError(`${nodeKind}: act() is not the execution path`)),
    executorSpec: {
      profile,
      harness: null,
      executor,
      execution: { correlation: { nodeKind } },
    },
  }
}

/** ADC's `integration.invoke`: one connector operation through the host's integrations effect. */
export function integrationInvokeKind(): NodeKind<
  IntegrationInvokeConfig,
  readonly ['integrations']
> {
  return {
    id: 'integration.invoke',
    version: 1,
    description: 'Invoke one connector operation through the host integrations effect.',
    validateConfig: (raw, context) => {
      const record = asRecord(raw, context)
      return {
        connector: requireString(record, 'connector', context),
        operation: requireString(record, 'operation', context),
      }
    },
    configSchema: {
      type: 'object',
      properties: { connector: { type: 'string' }, operation: { type: 'string' } },
      required: ['connector', 'operation'],
      additionalProperties: false,
    },
    inputs: [{ name: 'args', schema: { type: 'object' } }],
    outputs: [{ name: 'result', schema: {} }],
    effects: ['integrations'] as const,
    onCrash: 'restart',
    budget: 'exempt',
    run: ({ config, profile, inputs, effects }) =>
      hostLeaf(profile, 'integration.invoke/v1', () =>
        (effects.integrations as FakeIntegrations).invoke(
          config.connector,
          config.operation,
          (inputs.args ?? {}) as Readonly<Record<string, unknown>>,
        ),
      ),
  }
}

/** ADC's `notify`: render a template over the inputs and send it on one channel. */
export function notifyKind(): NodeKind<NotifyConfig, readonly ['notifier']> {
  return {
    id: 'notify',
    version: 1,
    description: 'Send one rendered message on a channel through the host notifier effect.',
    validateConfig: (raw, context) => {
      const record = asRecord(raw, context)
      return {
        channel: requireString(record, 'channel', context),
        template: requireString(record, 'template', context),
      }
    },
    configSchema: {
      type: 'object',
      properties: { channel: { type: 'string' }, template: { type: 'string' } },
      required: ['channel', 'template'],
      additionalProperties: false,
    },
    inputs: [{ name: 'message', schema: { type: 'string' } }],
    outputs: [],
    effects: ['notifier'] as const,
    onCrash: 'restart',
    budget: 'exempt',
    run: ({ config, profile, inputs, effects }) =>
      hostLeaf(profile, 'notify/v1', async () => {
        const message = config.template.replace('{message}', String(inputs.message ?? ''))
        await (effects.notifier as FakeNotifier).send(config.channel, message)
        return { sent: true, channel: config.channel }
      }),
  }
}
