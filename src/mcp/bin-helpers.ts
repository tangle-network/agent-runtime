/**
 *
 * Helpers extracted from `bin.ts` so the env-detection + executor-selection
 * logic is unit-testable without spawning a subprocess. The bin imports from
 * here; tests import from here directly.
 *
 * @experimental
 */

import type { SandboxClient } from '../runtime'
import {
  createFleetWorkspaceExecutor,
  createSiblingSandboxExecutor,
  type DelegationExecutor,
  type FleetHandle,
} from './executor'
import { createInProcessExecutor } from './in-process-executor'
import type { LocalHarness } from './local-harness'

/** @experimental */
export interface DetectExecutorArgs {
  sandboxClient: SandboxClient
  /** Raw env (defaults to `process.env`). Pass an explicit map for tests. */
  env?: Record<string, string | undefined>
  /**
   * Override how a fleet handle is resolved from the client + fleet id. The
   * default reads `client.fleets.get(fleetId)` and validates the returned
   * shape against the structural `FleetHandle` contract.
   */
  resolveFleet?: (client: SandboxClient, fleetId: string) => Promise<FleetHandle>
}

/**
 * Pick the right executor for an MCP server invocation based on env vars.
 *
 * - `TANGLE_FLEET_ID` set → fleet-workspace placement; resolves the handle
 *   via `sandboxClient.fleets.get(...)`.
 * - Otherwise → sibling-sandbox placement; each delegation creates a fresh
 *   sandbox via `sandboxClient.create(...)`.
 *
 * Fails loud (throws) when fleet mode is requested but the SDK shape is
 * incompatible — the operator chose fleet semantics, silently degrading to
 * sibling mode would lie about workspace topology.
 *
 * @experimental
 */
export async function detectExecutor(args: DetectExecutorArgs): Promise<DelegationExecutor> {
  const env = args.env ?? process.env

  // In-process (Phase 2.8): parent harness sets AGENT_RUNTIME_IN_SANDBOX=1
  // and points us at the workspace root. Highest-priority — when this is
  // set, delegations spawn local harness CLIs on git worktrees in the
  // SAME filesystem instead of provisioning sibling sandboxes.
  if (env.AGENT_RUNTIME_IN_SANDBOX === '1') {
    const repoRoot = env.AGENT_RUNTIME_REPO_ROOT?.trim()
    if (!repoRoot) {
      throw new Error(
        'agent-runtime-mcp: AGENT_RUNTIME_IN_SANDBOX=1 requires AGENT_RUNTIME_REPO_ROOT to point at the workspace root',
      )
    }
    return createInProcessExecutor({
      repoRoot,
      harnesses: parseHarnesses(env.AGENT_RUNTIME_LOCAL_HARNESSES),
      testCmd: env.AGENT_RUNTIME_TEST_CMD?.trim() || undefined,
      typecheckCmd: env.AGENT_RUNTIME_TYPECHECK_CMD?.trim() || undefined,
    })
  }

  const fleetId = parseFleetId(env.TANGLE_FLEET_ID)
  if (!fleetId) {
    return createSiblingSandboxExecutor({ client: args.sandboxClient })
  }
  const resolveFleet = args.resolveFleet ?? defaultResolveFleet
  const fleet = await resolveFleet(args.sandboxClient, fleetId)
  const excludeMachineIds = parseList(env.TANGLE_FLEET_EXCLUDE_MACHINES)
  return createFleetWorkspaceExecutor({
    fleet,
    excludeMachineIds,
  })
}

const KNOWN_HARNESSES: ReadonlyArray<LocalHarness> = ['claude', 'codex', 'opencode']

function parseHarnesses(raw: string | undefined): ReadonlyArray<LocalHarness> | undefined {
  if (!raw) return undefined
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  for (const part of parts) {
    if (!KNOWN_HARNESSES.includes(part as LocalHarness)) {
      throw new Error(
        `agent-runtime-mcp: AGENT_RUNTIME_LOCAL_HARNESSES contains unknown harness "${part}". Expected: ${KNOWN_HARNESSES.join(', ')}.`,
      )
    }
  }
  return parts as LocalHarness[]
}

interface FleetsApi {
  get(fleetId: string): Promise<unknown>
}

async function defaultResolveFleet(
  sandboxClient: SandboxClient,
  fleetId: string,
): Promise<FleetHandle> {
  const fleets = (sandboxClient as unknown as { fleets?: FleetsApi }).fleets
  if (!fleets || typeof fleets.get !== 'function') {
    throw new Error(
      'agent-runtime-mcp: the configured sandbox client does not expose `.fleets.get`; upgrade @tangle-network/sandbox to >= 0.2.1 or unset TANGLE_FLEET_ID.',
    )
  }
  const raw = await fleets.get(fleetId)
  if (!raw || typeof raw !== 'object') {
    throw new Error(`agent-runtime-mcp: fleets.get(${fleetId}) returned no handle`)
  }
  const handle = raw as Partial<FleetHandle>
  if (typeof handle.fleetId !== 'string' || !Array.isArray(handle.ids)) {
    throw new Error(
      `agent-runtime-mcp: fleet handle for ${fleetId} is missing fleetId/ids — incompatible sandbox SDK shape`,
    )
  }
  if (typeof handle.sandbox !== 'function') {
    throw new Error(
      `agent-runtime-mcp: fleet handle for ${fleetId} is missing sandbox(machineId) — incompatible sandbox SDK shape`,
    )
  }
  return handle as FleetHandle
}

function parseFleetId(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}
