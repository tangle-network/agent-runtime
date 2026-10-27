import { ValidationError } from '../../errors'
import type { GraphSubtasks, MakeWorkerAgent } from '../../mcp/tools/coordination-contracts'
import { errMessage } from './error-message'
import { flowModelPolicyProfile, runtimeFlowBrain } from './flow-brain'
import { createGraphOverlay, type GraphOverlay, productSpawnAuthority } from './graph-overlay'
import {
  type GraphSubtaskTopology,
  parseGraphSubtaskTopology,
  prepareGraphSubtask,
  validateGraphSubtask,
} from './graph-topology'
import { assertProfileModelsAllowed } from './model-policy'
import { kernelPromptRegistry } from './prompt-registry'
import { recursiveWorkerFactoryFor } from './recursive-worker-factory'
import type { RunCancelRequest } from './run-cancellation'
import type { ExecutorConfig } from './runtime'
import { storedGraphTopology } from './supervise-graph-subtasks'
import { DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY } from './supervise-profile-admission'
import type { prepareSuperviseRun } from './supervise-run-setup'
import { workerFromBackend } from './supervise-worker-backend'
import type { ExecutorFactory } from './types'
import { withWorkerSpawnRetry } from './worker-retry'

export function createSuperviseWorkers(
  setup: ReturnType<typeof prepareSuperviseRun>,
  cancelDurableRun: (reason: string, request?: RunCancelRequest) => void,
) {
  const {
    options,
    canonicalProfile,
    rootExecution,
    guidanceComposer,
    deliverable,
    analysts,
    journal,
    runId,
    rootOwnerId,
    now,
  } = setup
  const recoveryFactories = new WeakMap<MakeWorkerAgent, ExecutorFactory<unknown>>()
  // run_graph composes a pinned graph inside this run’s reservation; caller-owned workers opt out.
  const graphOverlays = new Set<GraphOverlay>()
  const graphSubtasks: GraphSubtasks | undefined =
    options.makeWorkerAgent === undefined
      ? {
          prepare: async (input) => {
            try {
              const topology =
                input.graphDigest === undefined
                  ? parseGraphSubtaskTopology(input.graph)
                  : await storedGraphTopology(options.graphRegistry, input.graphDigest)
              const prepared = prepareGraphSubtask(topology, {
                registry: kernelPromptRegistry(),
                ...(analysts ? { analysts } : {}),
                ...(guidanceComposer ? { guidance: guidanceComposer } : {}),
              })
              // Preflight every real node, including one named like the synthetic root.
              for (const profile of [
                prepared.profile,
                ...topology.nodes
                  .filter((node) => topology.entry !== undefined || node.id !== prepared.root)
                  .map((node) => guidanceComposer?.(node.profile) ?? node.profile),
              ]) {
                assertProfileModelsAllowed(
                  flowModelPolicyProfile(
                    profile,
                    profile === prepared.profile && topology.entry !== undefined
                      ? runtimeFlowBrain()
                      : undefined,
                  ),
                  options.allowedModels,
                )
                options.resolveSpawnProfile?.(profile)
              }
              return { ok: true as const, ...prepared }
            } catch (error) {
              return { ok: false as const, reason: errMessage(error) }
            }
          },
        }
      : undefined
  // Fresh and recovered subtasks rebuild the graph from their admitted topology.
  const productAuthority = productSpawnAuthority(options.authorizeSpawn)
  const graphOverlayFor = (topology: GraphSubtaskTopology) => {
    const registry = kernelPromptRegistry()
    const validated = validateGraphSubtask(topology, registry, analysts)
    const overlay = createGraphOverlay(validated, {
      registry,
      journal,
      runId,
      now,
      ...(guidanceComposer ? { guidance: guidanceComposer } : {}),
      ...(productAuthority ? { authorizeSpawn: productAuthority } : {}),
      subtask: true,
    })
    graphOverlays.add(overlay)
    return { overlay, validated }
  }
  let makeWorkerAgent = options.makeWorkerAgent
  if (!makeWorkerAgent) {
    if (!options.backend && !options.makeLeafAgent) {
      throw new ValidationError(
        'supervise: provide opts.backend (where workers run), opts.makeLeafAgent, or opts.makeWorkerAgent',
      )
    }
    // Both leaf paths share authorization and retry only refused-before-start work.
    const withRetry = (make: MakeWorkerAgent): MakeWorkerAgent =>
      withWorkerSpawnRetry(make, options.workerRetry, {
        ...(options.onWorkerRetry ? { onRetry: options.onWorkerRetry } : {}),
      })
    const makeLeaf = withRetry(
      options.makeLeafAgent ?? workerFromBackend(options.backend as ExecutorConfig, deliverable),
    )
    makeWorkerAgent = recursiveWorkerFactoryFor(
      {
        setup,
        cancelDurableRun,
        graphSubtasks,
        graphOverlayFor,
        recoveryFactories,
        withRetry,
        makeLeaf,
        securityPolicy: options.profileSecurity ?? DEFAULT_AUTHORED_PROFILE_SECURITY_POLICY,
      },
      {
        parent: canonicalProfile,
        parentIdentity: rootExecution.identity,
        depth: 1,
        parentOwnerId: rootOwnerId,
        analystLineage: false,
      },
    )
  }
  return { workerFactory: makeWorkerAgent, recoveryFactories, graphSubtasks, graphOverlays }
}
