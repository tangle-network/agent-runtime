import { z } from 'zod'
import { ValidationError } from '../../errors'
import { connectHttpMcp, type HttpMcpServerSpec } from '../http-mcp-client'
import type { WorkerEventCursor } from './worker-events'

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
  z.object({ status: z.literal('unavailable'), reason: z.string() }),
  z.object({
    status: z.literal('available'),
    entries: z.array(
      z.object({
        sequence: z.number().int().nonnegative(),
        at: z.number(),
        event: z.unknown(),
        omitted: z.string().optional(),
      }),
    ),
    cursor: z.object({ epoch: z.string(), next: z.number().int().nonnegative() }),
    reset: z.boolean(),
    historyExpired: z.boolean(),
    remaining: z.number().int().nonnegative(),
  }),
])

export type RemoteSupervisorTree = z.infer<typeof treeSchema>
export type RemoteSupervisorAgent = z.infer<typeof agentSchema>
export type RemoteWorkerEvents = z.infer<typeof eventPageSchema>

/** The existing coordination transport, restricted to reading the owned tree and worker output. */
export interface RemoteSupervisorReader {
  tree(): Promise<RemoteSupervisorTree>
  observe(
    workerId: string,
    cursor?: WorkerEventCursor,
  ): Promise<{ agent: Record<string, unknown>; events: RemoteWorkerEvents }>
  close(): Promise<void>
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
  const call = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const text = await connection.callTool('observe_agent', args)
    if (text.startsWith('ERROR:')) throw new ValidationError(text)
    const result = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
    if (result.error)
      throw new ValidationError(`remote supervisor refused observation: ${String(result.error)}`)
    return result
  }
  return {
    tree: async () => treeSchema.parse((await call({ tree: true })).tree),
    observe: async (workerId, cursor) => {
      const agent = await call({
        workerId,
        events: true,
        ...(cursor ? { eventCursor: cursor } : {}),
      })
      return { agent, events: eventPageSchema.parse(agent.events) }
    },
    close: () => connection.close(),
  }
}
