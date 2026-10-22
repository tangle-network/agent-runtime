import { ValidationError } from '../../errors'
import type { ExecutorConfig } from './executor-config'
import type { RootStreamSink } from './root-stream'
import { driveHarnessFromBackend } from './supervise-driver-session'
import { externalExecutionId } from './supervise-identity'
import type { SuperviseOptions } from './supervise-options'
import type { DriveHarness, DriveHarnessOwnerContext } from './supervisor-agent'
import type { SpawnJournal } from './types'

export interface ManagerHarnessSource {
  readonly options: SuperviseOptions
  /** The backend a manager's harness runs on when no caller-supplied harness drives it. */
  readonly managerBackend: ExecutorConfig | undefined
  /** Whether `managerBackend` can drive a manager without a caller-supplied harness. */
  readonly automaticDriver: boolean
  readonly runId: string
  readonly runNamespace: string
  readonly journal: SpawnJournal
  readonly rootStreamSink: RootStreamSink | undefined
}

/**
 * Resolve the harness that drives each manager owner: the caller's resolver or harness, claimed
 * per owner so one steerable harness never serves two managers, or one built from the backend.
 */
export function managerHarnessResolver(
  source: ManagerHarnessSource,
): (context: DriveHarnessOwnerContext) => DriveHarness | undefined {
  const { options, managerBackend } = source
  const claimDriveHarness = driveHarnessClaims()
  return (context) => {
    if (options.resolveDriveHarness) {
      return claimDriveHarness(options.resolveDriveHarness(context), context.ownerId)
    }
    if (options.driveHarness) {
      return claimDriveHarness(options.driveHarness, context.ownerId)
    }
    return managerBackend && source.automaticDriver
      ? driveHarnessFromBackend(
          managerBackend,
          externalExecutionId('supervised-manager', {
            runNamespace: source.runNamespace,
            ownerId: context.ownerId,
          }),
          options.now ?? Date.now,
          options.maxTurns,
          context.depth === 0 ? source.rootStreamSink : undefined,
          options.selectSeat === undefined
            ? undefined
            : {
                select: options.selectSeat,
                journal: source.journal,
                rootId: source.runId,
                onSegment: async (nodeId, segment, phase) => {
                  await emitSeatEvent(
                    source,
                    nodeId,
                    `${nodeId}:seat:${segment.startedAt}:${phase}`,
                    { nodeId, phase, segment },
                  )
                },
                onPause: async (nodeId, resumeAt, phase) => {
                  await emitSeatEvent(
                    source,
                    nodeId,
                    `${nodeId}:seat:${phase}:${resumeAt || (options.now?.() ?? Date.now())}`,
                    { nodeId, phase, ...(resumeAt ? { resumeAt } : {}) },
                  )
                },
              },
        )
      : undefined
  }
}

function emitSeatEvent(
  source: ManagerHarnessSource,
  nodeId: string,
  id: string,
  payload: Record<string, unknown>,
): ReturnType<NonNullable<NonNullable<SuperviseOptions['hooks']>['onEvent']>> | undefined {
  const { options } = source
  return options.hooks?.onEvent?.(
    {
      id,
      runId: source.runId,
      target: 'agent.seat',
      phase: 'event',
      timestamp: options.now?.() ?? Date.now(),
      parentId: nodeId,
      payload,
    },
    {},
  )
}

/** A harness claimed by one manager owner. A steerable harness binds to exactly one owner. */
function driveHarnessClaims(): (rawHarness: unknown, ownerId: string) => DriveHarness {
  const harnessClaims = new WeakMap<
    DriveHarness,
    { readonly owners: Set<string>; steerable: boolean }
  >()
  return (rawHarness, ownerId) => {
    if (typeof rawHarness !== 'function') {
      throw new ValidationError(
        'supervise: resolveDriveHarness must return a DriveHarness function',
      )
    }
    const harness = rawHarness as DriveHarness
    const deliver: unknown = harness.deliver
    if (deliver !== undefined && typeof deliver !== 'function') {
      throw new ValidationError('supervise: driveHarness.deliver must be a function when provided')
    }
    const deliverReady: unknown = harness.deliverReady
    if (deliverReady !== undefined && typeof deliverReady !== 'function') {
      throw new ValidationError(
        'supervise: driveHarness.deliverReady must be a function when provided',
      )
    }
    const claim = harnessClaims.get(harness)
    const conflictingOwner = claim
      ? [...claim.owners].find((claimedOwner) => claimedOwner !== ownerId)
      : undefined
    const steerable = typeof deliver === 'function'
    if (conflictingOwner !== undefined && (steerable || claim?.steerable === true)) {
      throw new ValidationError(
        `supervise: steerable driveHarness is already bound to manager owner ${JSON.stringify(conflictingOwner)}; resolveDriveHarness must return a distinct steerable instance for owner ${JSON.stringify(ownerId)}`,
      )
    }
    if (claim) {
      claim.owners.add(ownerId)
      claim.steerable ||= steerable
    } else {
      harnessClaims.set(harness, { owners: new Set([ownerId]), steerable })
    }
    return harness
  }
}
