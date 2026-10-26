import { z } from 'zod'
import { ValidationError } from '../../errors'
import {
  type DownMessageDeliveryOutcome,
  downMessageRefusalReasons,
} from '../../mcp/tools/coordination-messages'
import { connectHttpMcp, type HttpMcpServerSpec } from '../http-mcp-client'
import type { StdioMcpConnection } from '../stdio-mcp-client'
import { coordinationControlToolNames } from './coordination-credentials'
import type { CoordinationControlAccess } from './coordination-mcp'
import type { WorkerEventCursor, WorkerEventPage } from './worker-events'

const agentSchema = z
  .object({
    id: z.string(),
    parent: z.string().optional(),
    label: z.string(),
    status: z.string(),
    runtime: z.string(),
  })
  .passthrough()
const treeSchema = z.object({
  root: z.string(),
  nodes: z.array(agentSchema),
  inFlight: z.number().int().nonnegative(),
})
const eventPageSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['unknown-worker', 'not-captured']),
  }),
  z.object({
    status: z.literal('available'),
    entries: z.array(
      z.object({
        sequence: z.number().int().nonnegative(),
        at: z.number(),
        event: z.unknown(),
        omitted: z.enum(['event-too-large', 'event-not-serializable']).optional(),
      }),
    ),
    cursor: z.object({ epoch: z.string(), next: z.number().int().nonnegative() }),
    reset: z.boolean(),
    historyExpired: z.boolean(),
    remaining: z.number().int().nonnegative(),
  }),
])

/** Minimal agent identity and topology returned by the protected reader. */
export interface RemoteSupervisorAgent {
  readonly id: string
  readonly parent?: string
  readonly label: string
  readonly status: string
  readonly runtime: string
}

/** Current owned tree, including nested managers and resumed nodes. */
export interface RemoteSupervisorTree {
  readonly root: string
  readonly nodes: readonly RemoteSupervisorAgent[]
  readonly inFlight: number
}

/** The same bounded event page served by Scope's live observation owner. */
export type RemoteWorkerEvents = WorkerEventPage

/** The existing coordination transport, restricted to reading the owned tree and worker output. */
export interface RemoteSupervisorReader {
  tree(): Promise<RemoteSupervisorTree>
  observe(
    workerId: string,
    cursor?: WorkerEventCursor,
  ): Promise<{ agent: Record<string, unknown>; events: RemoteWorkerEvents }>
  close(): Promise<void>
}

const steerSchema = z.discriminatedUnion('delivered', [
  z.object({ delivered: z.literal(true), progress: z.record(z.string(), z.unknown()).nullable() }),
  z.object({
    delivered: z.literal(false),
    outcome: z.custom<Exclude<DownMessageDeliveryOutcome, 'delivered'>>(
      (value) =>
        typeof value === 'string' &&
        value !== 'delivered' &&
        Object.hasOwn(downMessageRefusalReasons, value),
    ),
    reason: z.string(),
    progress: z.record(z.string(), z.unknown()).nullable(),
  }),
])
const workerCounts = {
  live: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
}
const cancelSchema = z.union([
  z.object({
    cancelled: z.literal(true),
    workerId: z.string(),
    label: z.string(),
    ...workerCounts,
  }),
  z.object({ released: z.literal(true), workerId: z.string(), ...workerCounts }),
  z.object({ error: z.literal('not-live'), reason: z.string(), ...workerCounts }),
])

/** Actual handler outcomes; queue admission never stands in for delivered steering. */
export type RemoteSupervisorSteerResult = z.infer<typeof steerSchema>
export type RemoteSupervisorCancelResult = z.infer<typeof cancelSchema>

/** A separate capability for the same manager's owned workers, without manager tool grants. */
export interface RemoteSupervisorControl extends RemoteSupervisorReader {
  steer(
    workerId: string,
    instruction: string,
    options?: { readonly interrupt?: boolean },
  ): Promise<RemoteSupervisorSteerResult>
  cancel(workerId: string, reason?: string): Promise<RemoteSupervisorCancelResult>
}

async function callRemoteSupervisor(
  connection: StdioMcpConnection,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const text = await connection.callTool(tool, args)
  if (text.startsWith('ERROR:')) throw new ValidationError(text)
  return z.record(z.string(), z.unknown()).parse(JSON.parse(text))
}

function supervisorReader(connection: StdioMcpConnection): RemoteSupervisorReader {
  const observe = async (args: Record<string, unknown>) => {
    const result = await callRemoteSupervisor(connection, 'observe_agent', args)
    if (result.error)
      throw new ValidationError(`remote supervisor refused observation: ${String(result.error)}`)
    return result
  }
  return {
    tree: async () => treeSchema.parse((await observe({ tree: true })).tree),
    observe: async (workerId, cursor) => {
      const agent = await observe({
        workerId,
        events: true,
        ...(cursor ? { eventCursor: cursor } : {}),
      })
      return { agent, events: eventPageSchema.parse(agent.events) }
    },
    close: () => connection.close(),
  }
}

/** Connect with the server's readOnly URL and protected headers; credentials never enter a profile. */
export async function connectRemoteSupervisor(
  spec: HttpMcpServerSpec,
): Promise<RemoteSupervisorReader> {
  const connection = await connectHttpMcp(spec)
  if (!connection.tools.some((tool) => tool.name === 'observe_agent')) {
    await connection.close()
    throw new ValidationError('remote supervisor does not expose observe_agent')
  }
  return supervisorReader(connection)
}

/** Connect with the dedicated /control capability, keeping credentials on the protected transport. */
export async function connectRemoteSupervisorControl(
  access: CoordinationControlAccess,
): Promise<RemoteSupervisorControl> {
  const connection = await connectHttpMcp({
    url: access.url,
    protectedHeaders: { ...access.headers },
  })
  const granted = new Set(connection.tools.map((tool) => tool.name))
  if (
    granted.size !== coordinationControlToolNames.length ||
    !coordinationControlToolNames.every((tool) => granted.has(tool))
  ) {
    await connection.close()
    throw new ValidationError('remote supervisor control requires the exact operator tool set')
  }
  return {
    ...supervisorReader(connection),
    steer: async (workerId, instruction, options = {}) =>
      steerSchema.parse(
        await callRemoteSupervisor(connection, 'steer_agent', {
          workerId,
          instruction,
          ...(options.interrupt === undefined ? {} : { interrupt: options.interrupt }),
        }),
      ),
    cancel: async (workerId, reason) =>
      cancelSchema.parse(
        await callRemoteSupervisor(connection, 'cancel_worker', {
          workerId,
          ...(reason === undefined ? {} : { reason }),
        }),
      ),
  }
}
