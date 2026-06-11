/**
 * EnterpriseOps as an `AgenticSurface` — the EOPS instance of the general agentic primitive.
 *
 * This is ALL the EOPS-specific code: open = seed an isolated gym DB; tools = the gym's MCP tool
 * schemas; call = an MCP tools/call; score = the deterministic SQL verifiers; close = delete the DB.
 * Reuses the primitives proven against the live container in gym-agent.ts. A new domain (Commit0,
 * AppWorld, terminal-bench) ships its own file like this one — the drivers in agentic.ts never change.
 */

import type { AgenticSurface, AgenticTask, AgenticTool, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/loops'
import { callTool, deleteDb, type GymServer, type GymVerifier, loadTools, runVerifiers, seed } from './gym-agent'

interface EopsMeta {
  servers: GymServer[]
  verifiers: GymVerifier[]
  selectedTools: string[]
}

function metaOf(task: AgenticTask): EopsMeta {
  const m = task.meta as EopsMeta | undefined
  if (!m || !Array.isArray(m.servers) || !Array.isArray(m.verifiers)) {
    throw new Error(`eops surface: task ${task.id} missing meta.servers/verifiers`)
  }
  return m
}

/** Build an `AgenticTask` from an EnterpriseOps HF row (the EOPS-shaped fields go in `meta`). */
export function eopsTaskFromRow(row: {
  task_id: string
  system_prompt: string
  user_prompt: string
  selected_tools: string[]
  gym_servers_config: string | GymServer[]
  verifiers: string | GymVerifier[]
}): AgenticTask {
  const arr = <T,>(v: string | T[]): T[] => (typeof v === 'string' ? (JSON.parse(v) as T[]) : v)
  return {
    id: row.task_id,
    systemPrompt: row.system_prompt,
    userPrompt: row.user_prompt,
    meta: {
      servers: arr<GymServer>(row.gym_servers_config),
      verifiers: arr<GymVerifier>(row.verifiers),
      selectedTools: row.selected_tools,
    } satisfies EopsMeta,
  }
}

/** Load `n` EOPS tasks from the HF datasets-server, `offset` into the split — the one
 *  task supply for the stream/holdout runners (disjoint slices via disjoint offsets). */
export async function loadEopsTasks(n: number, offset: number, split: string): Promise<AgenticTask[]> {
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent('ServiceNow-AI/EnterpriseOps-Gym')}&config=oracle&split=${split}&offset=${offset}&length=${n}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`EOPS HF rows HTTP ${res.status}`)
  const body = (await res.json()) as { rows?: Array<{ row: Parameters<typeof eopsTaskFromRow>[0] }> }
  return (body.rows ?? []).slice(0, n).map(({ row }) => eopsTaskFromRow(row))
}

/** The EOPS task class — the task FAMILY key certified memory matches on (the gym the
 *  task runs against, e.g. `eops:gym-itsm-mcp`). Family-level on purpose: it is the
 *  granularity the certifying runs gated at (a whole-split promotion gate certifies the
 *  program for the family, not for one verifier signature). Missing meta fails loud. */
export function eopsTaskClass(task: AgenticTask): string {
  const server = metaOf(task).servers[0]
  if (!server?.mcp_server_name) {
    throw new Error(`eops task class: task ${task.id} has no servers[0].mcp_server_name`)
  }
  return `eops:${server.mcp_server_name}`
}

/** The EnterpriseOps surface. `gymDbsDir` = the unzipped gym_dbs.zip (resolves seed_database_file). */
export function createEopsSurface(gymDbsDir: string): AgenticSurface {
  return {
    name: 'eops',
    async open(task: AgenticTask): Promise<ArtifactHandle> {
      // Clone the server config and seed a fresh isolated DB (seed() stamps server._database_id).
      const server: GymServer = { ...metaOf(task).servers[0]! }
      await seed(server, gymDbsDir)
      return { id: server._database_id ?? task.id, surface: 'eops', ctx: server }
    },
    async tools(task: AgenticTask, handle: ArtifactHandle): Promise<AgenticTool[]> {
      return loadTools(handle.ctx as GymServer, metaOf(task).selectedTools)
    },
    call(handle: ArtifactHandle, name: string, args: Record<string, unknown>): Promise<string> {
      return callTool(handle.ctx as GymServer, name, args)
    },
    async score(task: AgenticTask, handle: ArtifactHandle): Promise<SurfaceScore> {
      const server = handle.ctx as GymServer
      return runVerifiers({ servers: [server], verifiers: metaOf(task).verifiers } as never)
    },
    close(handle: ArtifactHandle): Promise<void> {
      return deleteDb(handle.ctx as GymServer)
    },
  }
}
