/**
 * @experimental
 *
 * Delegation executors — the layer between MCP delegates and the sandbox
 * substrate. Each executor exposes a {@link LoopSandboxClient} the kernel
 * consumes plus a placement tag so the trace pipeline can correlate workers
 * with their physical placement.
 *
 * Two implementations ship in-box:
 *
 * - {@link createSiblingSandboxExecutor} — every delegation spawns a fresh
 *   sandbox sibling to the caller. Default when the MCP server runs as a
 *   standalone CLI mounted outside a fleet.
 *
 * - {@link createFleetWorkspaceExecutor} — delegations dispatch onto machines
 *   in the caller's existing fleet so worker diffs land directly on the
 *   caller's filesystem (the fleet's shared workspace). Selected when the
 *   parent sandbox passes `TANGLE_FLEET_ID` into the MCP server's env.
 */

import type { CreateSandboxOptions, SandboxInstance } from '@tangle-network/sandbox'
import type { LoopSandboxClient, LoopSandboxPlacement } from '../runtime'

/** @experimental */
export interface DelegationExecutor {
  /** Sandbox client the kernel calls. Returned with `describePlacement` set. */
  readonly client: LoopSandboxClient
  /** Best-effort one-liner used in stderr boot logs and diagnostics. */
  describe(): string
}

/** @experimental */
export interface SiblingSandboxExecutorOptions {
  client: LoopSandboxClient
}

/**
 * Wrap a raw sandbox SDK client so the kernel emits
 * `loop.iteration.dispatch` events with `{ placement: 'sibling', sandboxId }`.
 *
 * The returned client `.create()` delegates to the underlying client; the
 * only added behavior is a `describePlacement` tag the kernel reads.
 *
 * @experimental
 */
export function createSiblingSandboxExecutor(
  options: SiblingSandboxExecutorOptions,
): DelegationExecutor {
  const underlying = options.client
  const client: LoopSandboxClient = {
    create(opts?: CreateSandboxOptions): Promise<SandboxInstance> {
      return underlying.create(opts)
    },
    describePlacement(box: SandboxInstance): LoopSandboxPlacement {
      return { kind: 'sibling', sandboxId: readId(box) }
    },
  }
  return {
    client,
    describe(): string {
      return 'sibling-sandbox (each delegation = fresh sandbox via client.create)'
    },
  }
}

/**
 * Minimal `SandboxFleet` surface the fleet executor calls. Declared
 * structurally so tests can pass an in-memory stub without instantiating the
 * sandbox SDK.
 *
 * @experimental
 */
export interface FleetHandle {
  readonly fleetId: string
  /** Machine ids in dispatch-eligible order. The executor round-robins. */
  readonly ids: ReadonlyArray<string>
  /** Resolve a machine id to its `SandboxInstance` — that machine is mounted
   * on the fleet's shared workspace, so any diff the worker writes lands on
   * every other fleet machine's filesystem too. */
  sandbox(machineId: string): Promise<SandboxInstance>
}

/** @experimental */
export interface FleetWorkspaceExecutorOptions {
  fleet: FleetHandle
  /**
   * Override the machine-selection policy. Default = round-robin across
   * `fleet.ids`, skipping the optional `excludeMachineIds` set (typically the
   * coordinator machine the MCP server is running on).
   */
  selectMachine?: (call: { callIndex: number; ids: ReadonlyArray<string> }) => string
  /**
   * Machine ids to skip during default round-robin. Set to the caller's own
   * machineId so workers don't compete with the orchestrator on the same VM.
   */
  excludeMachineIds?: ReadonlyArray<string>
}

/**
 * Build an executor that resolves each delegated iteration to an existing
 * machine in `fleet`. The fleet's shared-workspace policy means the worker
 * machine sees the caller's filesystem — diffs land in-place with no
 * cross-sandbox copy step.
 *
 * @experimental
 */
export function createFleetWorkspaceExecutor(
  options: FleetWorkspaceExecutorOptions,
): DelegationExecutor {
  const fleet = options.fleet
  const exclude = new Set(options.excludeMachineIds ?? [])
  let callIndex = 0
  // machineId-by-sandboxId, populated as we resolve machines so
  // `describePlacement` can recover the assignment from the SandboxInstance
  // the kernel hands back.
  const placementBySandboxId = new Map<string, { machineId: string }>()

  const client: LoopSandboxClient = {
    async create(): Promise<SandboxInstance> {
      const ids = fleet.ids.filter((id) => !exclude.has(id))
      if (ids.length === 0) {
        throw new Error(
          `agent-runtime: fleet ${fleet.fleetId} has no eligible worker machines (ids=[${fleet.ids.join(',')}], excluded=[${[...exclude].join(',')}])`,
        )
      }
      const selector = options.selectMachine
      const machineId = selector ? selector({ callIndex, ids }) : ids[callIndex % ids.length]
      callIndex += 1
      if (typeof machineId !== 'string' || machineId.length === 0) {
        throw new Error('agent-runtime: fleet executor selectMachine returned an empty machine id')
      }
      const box = await fleet.sandbox(machineId)
      const sandboxId = readId(box)
      if (sandboxId) placementBySandboxId.set(sandboxId, { machineId })
      return box
    },
    describePlacement(box: SandboxInstance): LoopSandboxPlacement {
      const sandboxId = readId(box)
      const recorded = sandboxId ? placementBySandboxId.get(sandboxId) : undefined
      return {
        kind: 'fleet',
        sandboxId,
        fleetId: fleet.fleetId,
        machineId: recorded?.machineId,
      }
    },
  }

  return {
    client,
    describe(): string {
      const excluded = exclude.size > 0 ? ` (excluded=[${[...exclude].join(',')}])` : ''
      return `fleet-workspace (fleetId=${fleet.fleetId}, machines=[${fleet.ids.join(',')}]${excluded})`
    },
  }
}

function readId(box: SandboxInstance): string | undefined {
  const raw = (box as unknown as { id?: unknown }).id
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}
