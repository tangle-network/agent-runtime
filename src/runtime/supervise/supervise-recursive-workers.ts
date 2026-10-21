import { ValidationError } from '../../errors'
import type { GraphSubtasks, MakeWorkerAgent } from '../../mcp/tools/coordination-contracts'
import { errMessage } from './error-message'
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
  // `run_graph`: a manager starts an agent graph as ONE subtask. The graph's root node runs as a
  // nested manager of the caller, inside the caller's reservation, with the graph layer composed
  // around it (`graph-overlay`). Served only where this run builds the worker path, because that
  // path is what pins the graph's nodes; a caller-owned `makeWorkerAgent` decides its own children.
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
              // Every node is pinned, so a node the run would refuse at its spawn cannot be fixed
              // by the graph's driver. The run's model policy and pre-flight resolver judge every
              // node now, while the graph's author can still change it.
              for (const profile of [
                prepared.profile,
                ...topology.nodes
                  .filter((node) => node.id !== prepared.root)
                  .map((node) => guidanceComposer?.(node.profile) ?? node.profile),
              ]) {
                assertProfileModelsAllowed(profile, options.allowedModels)
                options.resolveSpawnProfile?.(profile)
              }
              return { ok: true as const, ...prepared }
            } catch (error) {
              return { ok: false as const, reason: errMessage(error) }
            }
          },
        }
      : undefined
  // The graph layer for the root of a `run_graph` subtask, rebuilt from the topology its admitted
  // profile carries — on a fresh spawn and on recovery alike.
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
    // A caller-owned leaf factory slots in here, under the same authorization and classification
    // every backend-derived leaf gets; `backend` is then only needed for a per-spawn deliverable.
    //
    // The retry seam wraps the leaf factory, so a spawn refused BEFORE the worker ran is
    // re-entered rather than settled dead. It sits inside the authorized path: the profile is
    // already decided, and a re-entry runs the same executor object the kernel admitted.
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
