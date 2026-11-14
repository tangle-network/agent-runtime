import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
  AgentTurnFailure,
} from '@tangle-network/agent-interface/environment-provider'
import type { RetainedRunHandle } from '../retained-run-types'
import { recordRuntimeOwnedProviderAttemptStart } from '../supervise/materialization'
import { concreteProfileModel } from '../supervise/model-policy'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import { detachedSnapshot } from '../supervise/snapshot'
import type { createPushTraceSource } from '../supervise/trace-source'
import type { ExecutorNodeContext, Spend, UsageEvent } from '../supervise/types'
import { providerExecutionSource } from './provider-execution-source'
import type { ProviderExecutorOptions } from './provider-executor-admission'
import type { ProviderExecutorScope } from './provider-executor-state'
import { ProviderFileOutput } from './provider-file-output'
import {
  providerTurnDefaults,
  providerTurnWithDefaults,
  taskToTurnInput,
} from './provider-turn-input'
import { ProviderTurnObserver } from './provider-turn-observer'
import { ProviderTurnSettlement } from './provider-turn-settlement'
import { ProviderUsageAccount } from './provider-usage-account'
import { ValidationError } from './provider-validation-error'

/** The turn this invocation sends: the task's turn under the provider's defaults and placement rules. */
function invocationTurn(args: StreamProviderExecutorArgs) {
  const linked = args.signal
  // READINESS IS THE PROVIDER'S CONTRACT. `create` resolves with an environment that can take a
  // turn, so this streams straight into it and adds no wait of its own. The sandbox seam's
  // `acquireSandbox` exists because a raw `SandboxClient.create` returns before the box is ready;
  // wrapping a second readiness poll around a provider that already honors the contract would hide
  // a provider that does not, and a provider that does not is an upstream defect to report.
  const defaultTurn = taskToTurnInput(args.task, linked)
  const turn = providerTurnWithDefaults(
    providerTurnDefaults(args.options.promptOptions, `providerAsExecutor(${args.provider.name})`),
    args.options.taskToTurn?.(args.task, args.profile, defaultTurn) ?? defaultTurn,
    linked,
  )
  if (args.options.defaults?.metadata?.runtimeProviderPlacement === undefined) return turn
  if (turn.model !== undefined && turn.model !== concreteProfileModel(args.profile)) {
    throw new ValidationError('provider placement: taskToTurn cannot replace the profile model')
  }
  const declared = providerTurnDefaults(args.options.promptOptions, 'provider placement')
  if (
    canonicalCandidateDigest(turn.providerOptions ?? {}) !==
    canonicalCandidateDigest(declared?.providerOptions ?? {})
  ) {
    throw new ValidationError(
      'provider placement: taskToTurn cannot replace declared provider options',
    )
  }
  const { signal: _signal, ...material } = turn
  return { ...detachedSnapshot(material, 'provider placement turn'), signal: linked }
}

export async function* streamProviderExecutor(
  args: StreamProviderExecutorArgs,
): AsyncGenerator<UsageEvent, ProviderInvocationEnd, undefined> {
  const started = Date.now()
  const turn = invocationTurn(args)
  args.scope.state.providerSessionId = turn.sessionId ?? null
  recordRuntimeOwnedProviderAttemptStart(args.scope.executor()) // one attempt per dispatch
  const source = await providerExecutionSource(args, turn, args.signal)
  const environment = source.environment
  // Adoption binds the environment identity and the applied resources it reports before the
  // turn starts streaming, so the finalized declaration is complete evidence.
  await args.onEnvironment(environment)
  args.scope.state.fileOutput =
    args.options.outputFile !== undefined ? new ProviderFileOutput(args) : undefined
  const usage = new ProviderUsageAccount(args, turn.model)
  const observer = new ProviderTurnObserver(args, usage, source.retained, turn.model)
  const settlement = new ProviderTurnSettlement(
    args,
    environment,
    source.retained,
    observer,
    usage,
    started,
  )
  try {
    yield* observer.consume(source.events)
    yield* settlement.settle()
  } catch (error) {
    yield* settlement.fail(error)
  } finally {
    await settlement.release()
  }
  return settlement.end()
}

export interface StreamProviderExecutorArgs {
  provider: AgentEnvironmentProvider
  profile: AgentProfile
  /** The exact profile handed to `provider.create` — the authored profile unless the caller
   *  installed a `profileForCreate` overlay. */
  createProfile: AgentProfile
  task: unknown
  signal: AbortSignal
  node?: ExecutorNodeContext
  options: ProviderExecutorOptions
  retention?: RetainedExecutorContext
  executionId: string
  trace: ReturnType<typeof createPushTraceSource>
  recovering: boolean
  /** The spend of this execution's earlier invocations. This invocation's cumulative token
   *  events and its settled spend continue from it, because the conserved pool reads one
   *  execution's totals and refuses a cumulative total that decreases. Absent for a first
   *  invocation. */
  carried?: Spend
  /** When the execution's first invocation started: a continued execution settles its whole
   *  duration, pauses included. */
  executionStartedAt: number
  /** Whether a refusal for capacity may end this invocation with its environment kept, for the
   *  caller to continue (`ProviderExecutorOptions.unavailablePause`). Only a retained source
   *  continues, because only it journals each invocation. */
  mayContinue: boolean
  /** The executor's state, mirrors and native control, which an invocation reports through. */
  scope: ProviderExecutorScope
  onRetained: (handle: RetainedRunHandle) => void
  onEnvironment: (environment: AgentEnvironment) => void | Promise<void>
}

export interface ProviderInvocationEnd {
  /** The upstream refused the turn for capacity, and the environment was kept to continue in. */
  readonly unavailable?: {
    readonly signal: string
    readonly cause: string
    readonly failure?: AgentTurnFailure
  }
  /** The execution's spend so far, this invocation included. */
  readonly spent?: Spend
  /** Whether this invocation itself spent anything before it ended. */
  readonly madeProgress: boolean
  readonly durationMs: number
}
