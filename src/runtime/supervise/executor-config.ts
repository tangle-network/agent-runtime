import { randomUUID } from 'node:crypto'
import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import type { BackendType } from '@tangle-network/sandbox'
import { ValidationError } from '../../errors'
import {
  placedProviderExecutor,
  providerAsExecutor,
} from '../environment-provider/provider-executor-admission'
import { resolveAgentEnvironmentProvider } from '../environment-provider/provider-registry'
import { providerAsSandboxClient } from '../environment-provider/provider-sandbox-adapter'
import { selectProviderPlacement } from '../provider-placement'
import type { ProviderWorkspaceCaptureReceipt } from '../provider-workspace-retention'
import { type BridgeSeam, validateBridgeModelCredential } from './bridge-config'
import { bridgeExecutor } from './bridge-executor'
import { cliInPlaceExecutor, cliWorktreeExecutor } from './cli-executor-factories'
import { cliExecutor } from './cli-process-executor'
import { executableAgentProfileSnapshot, executableAgentSpecSnapshot } from './executable-spec'
import { assertExactConfigKeys, readSeam } from './executor-seams'
import {
  attestRuntimeOwnedExecutor,
  inheritRuntimeOwnedExecutorAttestation,
  runtimeOwnedExecutorExecutionBinding,
  runtimeOwnedExecutorMaterialization,
} from './materialization'
import { retainedExecutorContext } from './retained-executor'
import { routerInlineExecutor } from './router-inline-executor'
import { routerToolsInlineExecutor } from './router-tools-executor'
import {
  type CliInPlaceSeam,
  type CliSeam,
  type CliWorktreeSeam,
  type ProviderSeam,
  providerSeamKey,
  type RouterSeam,
  type RouterToolsSeam,
  type SandboxSeam,
  sandboxCaptureOutputSeamKey,
  sandboxSeamKey,
} from './runtime-seams'
import { sandboxExecutor, sandboxExecutorForPath } from './sandbox-leaf-executor'
import { detachedSnapshot } from './snapshot'
import type { AgentSpec, ExecutorContext, ExecutorFactory, Runtime } from './types'
import { WORKER_TRACE_PROPAGATION } from './worker-trace'

/**
 * Config for {@link createExecutor}: the backend is DATA — the cost dial a profile,
 * an experiment config, or a replay journal can name — not an import choice. Each
 * variant carries its backend's seam.
 */
export type ExecutorConfig =
  | ({ backend: 'router' } & RouterSeam)
  | ({ backend: 'router-tools' } & RouterToolsSeam)
  | ({ backend: 'bridge' } & BridgeSeam)
  | ({ backend: 'cli' } & CliSeam)
  | ({ backend: 'cli-worktree' } & CliWorktreeSeam)
  | ({ backend: 'cli-in-place' } & CliInPlaceSeam)
  | ({ backend: 'provider' } & ProviderSeam)
  | ({ backend: 'sandbox' } & SandboxSeam)

/** Capture one public executor configuration at its call boundary. All data that selects policy,
 * model, process, limits, or backend behavior is detached and deeply frozen.
 * Explicit service/function fields remain live by reference because they are executable ports,
 * not portable configuration. */
export function snapshotExecutorConfig(config: ExecutorConfig): ExecutorConfig {
  switch (config.backend) {
    case 'router-tools': {
      const {
        complete,
        executeToolCall,
        onMessages,
        onToolStep,
        onProviderResponse,
        ...decisionData
      } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor router-tools config')
      return Object.freeze({
        ...snapshot,
        ...(complete === undefined ? {} : { complete }),
        executeToolCall,
        ...(onProviderResponse === undefined ? {} : { onProviderResponse }),
        ...(onMessages === undefined ? {} : { onMessages }),
        ...(onToolStep === undefined ? {} : { onToolStep }),
      })
    }
    case 'router': {
      const { complete, ...decisionData } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor router config')
      return Object.freeze({
        ...snapshot,
        ...(complete === undefined ? {} : { complete }),
      })
    }
    case 'cli-worktree': {
      if (config.bridge) {
        assertExactConfigKeys(
          config.bridge as unknown as Readonly<Record<string, unknown>>,
          new Set(['bridgeBearer', 'bridgeUrl', 'maxReconnects', 'sessionId', 'timeoutMs']),
          'createExecutor cli-worktree bridge config',
        )
      }
      const { runGit, runCommand, ...decisionData } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor cli-worktree config')
      return Object.freeze({
        ...snapshot,
        ...(runGit === undefined ? {} : { runGit }),
        ...(runCommand === undefined ? {} : { runCommand }),
      })
    }
    case 'cli-in-place': {
      assertExactConfigKeys(
        config as unknown as Readonly<Record<string, unknown>>,
        new Set(['backend', 'harnessTimeoutMs', 'runHarness', 'taskPrompt', 'workspacePath']),
        'createExecutor cli-in-place config',
      )
      const { runHarness, ...decisionData } = config
      const snapshot = detachedSnapshot(decisionData, 'createExecutor cli-in-place config')
      return Object.freeze({
        ...snapshot,
        ...(runHarness === undefined ? {} : { runHarness }),
      })
    }
    case 'provider': {
      if (config.outputFormat !== undefined && config.steering !== undefined)
        throw new ValidationError(
          'createExecutor(provider): JSON output is not supported with steering',
        )
      // `validator` is an executable port like `provider`: retained live by reference, never
      // cloned, because `detachedSnapshot` cannot structured-clone its `validate` method.
      const {
        provider,
        registry,
        profileForCreate,
        taskToTurn,
        validator,
        workspaceRetention,
        shared,
        ...decisionData
      } = config
      if (
        shared !== undefined &&
        (decisionData.steering !== undefined ||
          decisionData.placements !== undefined ||
          workspaceRetention !== undefined)
      ) {
        throw new ValidationError(
          'createExecutor(provider): shared placement cannot combine with steering, placements, or workspaceRetention',
        )
      }
      const snapshot = detachedSnapshot(decisionData, 'createExecutor provider config')
      // A registry is a live service. Resolve its mutable name mapping exactly once at intake and
      // retain the resulting provider instance, never the registry lookup for later execution.
      const resolvedProvider = resolveAgentEnvironmentProvider(provider, registry)
      return Object.freeze({
        ...snapshot,
        provider: resolvedProvider,
        ...(profileForCreate === undefined ? {} : { profileForCreate }),
        ...(taskToTurn === undefined ? {} : { taskToTurn }),
        ...(validator === undefined ? {} : { validator }),
        ...(workspaceRetention === undefined ? {} : { workspaceRetention }),
        // A live pool: every worker of the run must lease from the same boxes.
        ...(shared === undefined ? {} : { shared }),
      })
    }
    case 'sandbox': {
      assertExactConfigKeys(
        config as unknown as Readonly<Record<string, unknown>>,
        new Set([
          'backend',
          'failOnDestroyError',
          'workspaceCaptures',
          'lineage',
          'loopCtx',
          'maxIterations',
          'sandboxClient',
          'steering',
          'validator',
        ]),
        'createExecutor sandbox config',
      )
      // `validator` is an executable port like `sandboxClient`: retained live by reference,
      // never cloned, because `detachedSnapshot` cannot structured-clone its `validate` method.
      const { sandboxClient, loopCtx, validator, workspaceCaptures, ...decisionData } = config
      const port = {
        sandboxClient,
        ...(validator === undefined ? {} : { validator }),
        ...(workspaceCaptures === undefined ? {} : { workspaceCaptures }),
      }
      if (loopCtx === undefined) {
        const snapshot = detachedSnapshot(decisionData, 'createExecutor sandbox config')
        return Object.freeze({ ...snapshot, ...port })
      }
      const { hooks, traceEmitter, onSandboxEvent, runHandle, ...loopDecisionData } = loopCtx
      const snapshot = detachedSnapshot(
        { ...decisionData, loopCtx: loopDecisionData },
        'createExecutor sandbox config',
      )
      const loopSnapshot = snapshot.loopCtx
      return Object.freeze({
        ...snapshot,
        ...port,
        loopCtx: Object.freeze({
          ...loopSnapshot,
          ...(hooks === undefined ? {} : { hooks }),
          ...(traceEmitter === undefined ? {} : { traceEmitter }),
          ...(onSandboxEvent === undefined ? {} : { onSandboxEvent }),
          ...(runHandle === undefined ? {} : { runHandle }),
        }),
      })
    }
    case 'bridge': {
      assertExactConfigKeys(
        config as unknown as Readonly<Record<string, unknown>>,
        new Set([
          'activityWindow',
          'backend',
          'bridgeBearer',
          'bridgeUrl',
          'cwd',
          'harnessTranscript',
          'maxReconnects',
          'modelCredential',
          'modelSilenceMs',
          'outputFormat',
          'sessionId',
          'timeoutMs',
        ]),
        'createExecutor bridge config',
      )
      const { modelCredential, harnessTranscript, ...decisionData } = config
      if (harnessTranscript !== undefined && typeof harnessTranscript !== 'function')
        throw new ValidationError(
          'createExecutor bridge: harnessTranscript must be a capture function',
        )
      const snapshot = detachedSnapshot(decisionData, 'createExecutor bridge config')
      const capturedCredential = validateBridgeModelCredential(
        modelCredential,
        config.bridgeUrl,
        'createExecutor bridge config',
      )
      return Object.freeze({
        ...snapshot,
        ...(capturedCredential === undefined ? {} : { modelCredential: capturedCredential }),
        ...(harnessTranscript === undefined ? {} : { harnessTranscript }),
      })
    }
    case 'cli':
      return detachedSnapshot(config, `createExecutor ${config.backend} config`)
    default: {
      // The backend is DATA — a profile, an experiment config, or a replay journal names it — so
      // a value outside the union reaches here untyped. Without this arm the switch returns
      // `undefined`, `createExecutor` hands back a working-looking factory, and the failure lands
      // one call later as a TypeError that never names the backend that caused it.
      const named = (config as { backend?: unknown }).backend
      // The supported list is read off the trace-propagation table rather than written out again:
      // that table is `satisfies Record<ExecutorConfig['backend'], boolean>`, so it is the one
      // copy the compiler already forces to hold every arm.
      const supported = Object.keys(WORKER_TRACE_PROPAGATION).sort().join(', ')
      throw new ValidationError(
        `createExecutor: no backend named ${JSON.stringify(named)}; supported backends are ${supported}`,
      )
    }
  }
}

/** A backend config reused for multiple workers/managers cannot pin execution identity. */
export function captureReusableExecutorConfig(
  config: ExecutorConfig,
  context: string,
): ExecutorConfig {
  const captured = snapshotExecutorConfig(config)
  const fixedIdentity =
    captured.backend === 'bridge' && captured.sessionId !== undefined
      ? 'sessionId'
      : captured.backend === 'cli-worktree' && captured.runId !== undefined
        ? 'runId'
        : captured.backend === 'cli-worktree' && captured.bridge?.sessionId !== undefined
          ? 'bridge.sessionId'
          : undefined
  if (fixedIdentity !== undefined) {
    throw new ValidationError(
      `${context}: fixed ${fixedIdentity} is not allowed on a reusable backend; let each execution derive an isolated id`,
    )
  }
  return captured
}

/** Bind one already-captured reusable backend to the durable identity of the execution that will
 * use it. Stateful bridge backends need an explicit external id: a random default isolates two
 * siblings but cannot reconnect a replacement process to the same harness session. Non-stateful
 * backends carry no external execution id and are returned unchanged. */
export function bindReusableExecutorExecutionId(
  captured: ExecutorConfig,
  executionId: string,
): ExecutorConfig {
  if (typeof executionId !== 'string' || executionId.length === 0) {
    throw new ValidationError(
      'bindReusableExecutorExecutionId: executionId must be a non-empty string',
    )
  }
  switch (captured.backend) {
    case 'bridge':
      return Object.freeze({ ...captured, sessionId: executionId })
    case 'cli-worktree':
      // The bridged worktree derives `bridge-worktree-${runId}` when no inner session id is set,
      // so this one durable value binds both the worktree and its resumed harness conversation.
      return Object.freeze({ ...captured, runId: executionId })
    case 'router':
    case 'router-tools':
    case 'cli':
    case 'cli-in-place':
    case 'provider':
    case 'sandbox':
      return captured
  }
}

/**
 * The single built-in executor factory. Picks a leaf backend by data (`config.backend`),
 * injects the matching seam, and delegates to that backend's built-in implementation.
 * The `Executor` port stays OPEN: bring-your-own agents implement `Executor` directly, while Scope
 * or `createExecutorRegistry` still parses and seals their exact profile before use. Use this instead of a
 * per-vendor adapter or a closed `inline|sandbox|cli` switch — those bypass the
 * `UsageEvent` reporting channel.
 */
export function createExecutor(config: ExecutorConfig): ExecutorFactory<unknown> {
  const captured = snapshotExecutorConfig(config)
  return (rawSpec, ctx) => {
    const spec = executableAgentSpecSnapshot(rawSpec, `createExecutor(${captured.backend})`)
    const { backend, ...seamData } = captured as ExecutorConfig & Record<string, unknown>
    const seam = Object.freeze(seamData)
    const seamed: ExecutorContext = { ...ctx, seams: { ...ctx.seams, [backend]: seam } }
    switch (captured.backend) {
      case 'router':
        return routerInlineExecutor(spec, seamed)
      case 'router-tools':
        return routerToolsInlineExecutor(spec, seamed)
      case 'bridge':
        return bridgeExecutor(spec, seamed)
      case 'cli':
        return cliExecutor(spec, seamed)
      case 'cli-worktree':
        return cliWorktreeExecutor(spec, seamed)
      case 'cli-in-place':
        return cliInPlaceExecutor(spec, seamed)
      case 'provider': {
        const originalSeam = readSeam<ProviderSeam>(seamed, providerSeamKey, 'provider')
        const selected = originalSeam.steering
          ? selectProviderPlacement(spec.profile, originalSeam)
          : undefined
        const providerSeam = selected?.options ?? originalSeam
        const provider = resolveAgentEnvironmentProvider(
          providerSeam.provider,
          providerSeam.registry,
        )
        if (providerSeam.steering) {
          if (providerSeam.taskToTurn) {
            throw new ValidationError(
              'createExecutor(provider, steering): taskToTurn is not representable by the text-only steerable session',
            )
          }
          if (providerSeam.destroyOnSettle === false) {
            throw new ValidationError(
              'createExecutor(provider, steering): destroyOnSettle=false conflicts with the session-owned environment lifecycle',
            )
          }
          if (providerSeam.validator) {
            throw new ValidationError(
              'createExecutor(provider, steering): validator is not representable with steering — the steerable session is a multi-turn session on one environment, not a scored single-shot leaf, so the score would be silently dropped',
            )
          }
          const harness = requiredProviderProfileHarness(spec, providerSeam)
          const workspaceCaptures: ProviderWorkspaceCaptureReceipt[] = []
          let capturedOutput: (() => unknown) | undefined
          const publishEvidence = retainedExecutorContext(seamed)?.onEvidence
          const sandboxClient = providerAsSandboxClient(provider, {
            defaults: {
              ...(providerSeam.defaults ?? {}),
              idempotencyKey:
                providerSeam.defaults?.idempotencyKey ?? seamed.node?.attemptId ?? randomUUID(),
              signal: seamed.signal,
            },
            requireTerminalEvent: providerSeam.requireTerminalEvent,
            requireSession: true,
            ...(providerSeam.workspaceRetention === undefined
              ? {}
              : {
                  workspaceRetention: providerSeam.workspaceRetention,
                  retentionIdentity: {
                    executionId: seamed.node?.nodeId ?? `provider-run-${randomUUID()}`,
                    profile: spec.profile,
                    ...(seamed.node === undefined ? {} : { node: seamed.node }),
                  },
                  onWorkspaceCaptured: async (receipt: ProviderWorkspaceCaptureReceipt) => {
                    if (!workspaceCaptures.includes(receipt)) workspaceCaptures.push(receipt)
                    if (publishEvidence !== undefined) {
                      if (capturedOutput === undefined) {
                        throw new ValidationError('provider capture has no bound session output')
                      }
                      await publishEvidence(capturedOutput())
                    }
                  },
                }),
          })
          // The steerable session already speaks this vocabulary: it reads
          // `ExecCtx.promptOptions` and the composed client raises them back onto
          // `AgentTurnInput.providerOptions` before the provider sees them. One declaration on the
          // provider seam therefore serves the plain and the steerable path with no translation.
          const providerCtx: ExecutorContext = {
            ...seamed,
            seams: {
              ...seamed.seams,
              [sandboxCaptureOutputSeamKey]: (read: () => unknown) => {
                capturedOutput = read
              },
              [sandboxSeamKey]: {
                sandboxClient,
                failOnDestroyError: providerSeam.workspaceRetention !== undefined,
                ...(providerSeam.workspaceRetention === undefined
                  ? {}
                  : { workspaceCaptures: () => workspaceCaptures }),
                steering: providerSeam.steering,
                ...(providerSeam.promptOptions === undefined
                  ? {}
                  : { loopCtx: { promptOptions: providerSeam.promptOptions } }),
              } satisfies SandboxSeam,
            },
          }
          const executor = sandboxExecutorForPath({ ...spec, harness }, providerCtx, 'provider')
          // The copy renames the runtime only; it must keep the sandbox executor's materialization
          // evidence, or exact turn execution would refuse the executor Runtime itself built.
          const wrapper = inheritRuntimeOwnedExecutorAttestation(executor, {
            ...executor,
            runtime: providerSeam.runtime ?? (provider.name as Runtime),
          })
          if (selected?.identity) {
            const declaration = runtimeOwnedExecutorMaterialization(executor)!
            const binding = runtimeOwnedExecutorExecutionBinding(executor)!
            attestRuntimeOwnedExecutor(
              wrapper,
              {
                ...declaration,
                plan: { ...(declaration.plan as object), placement: selected.identity },
              },
              {
                ...binding,
                binding: { ...(binding.binding as object), placement: selected.identity },
                descriptor: {
                  ...binding.descriptor,
                  placementId: selected.identity.id,
                  placementDigest: selected.identity.digest,
                },
              },
            )
          }
          return wrapper
        }
        const profileForCreate = providerSeam.profileForCreate
        const exactProfileForCreate = (profile: AgentProfile): AgentProfile => {
          const prepared = executableAgentProfileSnapshot(
            profileForCreate?.(profile) ?? profile,
            'createExecutor(provider)',
          )
          if (canonicalAgentProfileDigest(prepared) !== canonicalAgentProfileDigest(profile)) {
            throw new ValidationError(
              'createExecutor(provider): profileForCreate changed the exact AgentProfile; execution overlays are not allowed',
            )
          }
          return prepared
        }
        const shared = providerSeam.shared
        if (shared !== undefined && shared.refusal(spec.profile) === undefined) {
          // The shared box owns the box-level create options, so the dedicated provider's
          // defaults (its resources, egress and secrets) do not apply to a shared worker.
          const {
            provider: _provider,
            registry: _registry,
            shared: _shared,
            defaults: _defaults,
            ...turnOptions
          } = providerSeam
          return placedProviderExecutor(
            // The node id names this worker to the router on the box's shared key.
            shared.providerFor(seamed.node === undefined ? {} : { nodeId: seamed.node.nodeId }),
            { ...turnOptions, profileForCreate: exactProfileForCreate },
            shared.identity,
          )(spec, seamed)
        }
        return providerAsExecutor(provider, {
          ...providerSeam,
          profileForCreate: exactProfileForCreate,
        })(spec, seamed)
      }
      case 'sandbox': {
        const harness = spec.profile.harness as BackendType
        if (spec.harness != null && spec.harness !== harness) {
          throw new ValidationError(
            `createExecutor(sandbox): AgentSpec.harness ${JSON.stringify(spec.harness)} conflicts with AgentProfile.harness ${JSON.stringify(harness)}`,
          )
        }
        return sandboxExecutor({ ...spec, harness }, seamed)
      }
    }
  }
}

function requiredProviderProfileHarness(spec: AgentSpec, seam: ProviderSeam): BackendType {
  const harness = spec.profile.harness
  if (harness === undefined) {
    throw new ValidationError(
      'createExecutor(provider, steering): AgentProfile.harness is required',
    )
  }
  if (spec.harness != null && spec.harness !== harness) {
    throw new ValidationError(
      `createExecutor(provider, steering): AgentSpec.harness "${spec.harness}" conflicts with AgentProfile.harness "${harness}"`,
    )
  }
  if (seam.defaults?.backend !== undefined && seam.defaults.backend !== harness) {
    throw new ValidationError(
      `createExecutor(provider, steering): provider default backend "${seam.defaults.backend}" conflicts with AgentProfile.harness "${harness}"`,
    )
  }
  return harness as BackendType
}
