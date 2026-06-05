/**
 * An agentic EnterpriseOps shot — a real tool-calling loop, NOT a one-shot plan.
 *
 * The agent gets the gym's MCP tools as OpenAI function-tools and loops: completion → tool_calls
 * → execute each against the gym (mutating its seeded DB) → feed results back → repeat, until it
 * stops calling tools or hits maxTurns. This is the "shot" the gate's leaf should be on an agentic
 * domain: the agent sees tool RESULTS and adapts, so it can do multi-step work (look up an id, then
 * use it) that a blind single completion cannot. Score = the deterministic verifiers over the final
 * DB state. Each shot seeds its OWN isolated database (its own database_id), so n shots run
 * concurrently without colliding.
 *
 * Self-contained against the live gym (router + HTTP), no sandbox: an agentic shot here is a
 * tool-calling loop, which the router serves directly. The same seed/replay/verify protocol the
 * judge proved (scripts/enterpriseops_gym_judge.py) — lifted to a live loop instead of a transcript
 * replay.
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

export interface GymServer {
  mcp_server_name: string
  mcp_server_url: string
  seed_database_file: string
  context?: Record<string, string>
  /** The per-rollout isolated database id, attached after seeding (every call targets it). */
  _database_id?: string
}

export interface GymVerifier {
  name: string
  gym_name: string
  validation_config: { query: string; expected_value: unknown; comparison_type: string }
}

export interface GymTask {
  id: string
  systemPrompt: string
  userPrompt: string
  selectedTools: string[]
  servers: GymServer[]
  verifiers: GymVerifier[]
}

export interface GymShotResult {
  passes: number
  total: number
  score: number
  resolved: boolean
  turns: number
  toolCalls: number
  toolErrors: number
  /** Verifiers excluded because their SQL was rejected by the server (data defect, not the agent). */
  verifierErrors: number
  /** True when NO verifier ran (every one was malformed) — the task is unscoreable; skip it. */
  unscoreable: boolean
}

interface OpenAiTool {
  type: 'function'
  function: { name: string; description?: string; parameters: Record<string, unknown> }
}

interface ToolCall {
  id: string
  function: { name: string; arguments: string }
}

const headersFor = (server: GymServer): Record<string, string> => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  ...(server.context ?? {}),
  ...(server._database_id ? { 'x-database-id': server._database_id } : {}),
})

function parseBody(raw: string): unknown {
  const text = raw.trim()
  if (!text) return {}
  if (text.startsWith('event:') || text.startsWith('data:') || text.includes('\ndata:')) {
    const matches = [...text.matchAll(/data:\s*(\{[\s\S]*?\})\s*(?:\n|$)/g)]
    if (matches.length > 0) return JSON.parse(matches[matches.length - 1]![1]!)
  }
  return JSON.parse(text)
}

async function httpPost(url: string, payload: unknown, headers: Record<string, string>, method = 'POST'): Promise<string> {
  const res = await fetch(url, { method, headers, body: JSON.stringify(payload) })
  if (!res.ok) throw new HttpError(res.status, (await res.text()).slice(0, 200))
  return res.text()
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body}`)
  }
}

/** Seed an isolated DB for this shot from the task's snapshot; sets `server._database_id`. */
async function seed(server: GymServer, gymDbsDir: string): Promise<void> {
  if (!server.seed_database_file) throw new Error(`server ${server.mcp_server_name} has no seed_database_file`)
  const path = isAbsolute(server.seed_database_file) ? server.seed_database_file : join(gymDbsDir, server.seed_database_file)
  const sql = await readFile(path, 'utf8')
  const dbId = `gate_${Math.random().toString(16).slice(2, 14)}`
  const url = `${server.mcp_server_url.replace(/\/$/, '')}/api/seed-database`
  await httpPost(url, { database_id: dbId, name: `gate_${dbId}`, description: 'agentic shot', sql_content: sql }, {
    'content-type': 'application/json',
  })
  server._database_id = dbId
}

async function deleteDb(server: GymServer): Promise<void> {
  if (!server._database_id) return
  const url = `${server.mcp_server_url.replace(/\/$/, '')}/api/delete-database`
  await httpPost(url, { database_id: server._database_id }, { 'content-type': 'application/json' }, 'DELETE').catch(() => {})
}

/** Fetch the gym's MCP tool schemas and project them into OpenAI function-tools, filtered to the
 *  task's selected_tools (the allow-list the agent may call). */
async function loadTools(server: GymServer, selected: string[]): Promise<OpenAiTool[]> {
  const url = `${server.mcp_server_url.replace(/\/$/, '')}/mcp`
  const raw = await httpPost(url, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, headersFor(server))
  const body = parseBody(raw) as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> } }
  const allow = new Set(selected)
  const tools: OpenAiTool[] = []
  for (const t of body.result?.tools ?? []) {
    if (!allow.has(t.name)) continue
    tools.push({
      type: 'function',
      function: {
        name: t.name,
        ...(t.description ? { description: t.description.slice(0, 1024) } : {}),
        parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
      },
    })
  }
  return tools
}

async function callTool(server: GymServer, name: string, args: Record<string, unknown>): Promise<string> {
  const url = `${server.mcp_server_url.replace(/\/$/, '')}/mcp`
  const raw = await httpPost(
    url,
    { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } },
    headersFor(server),
  )
  const body = parseBody(raw) as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: unknown }
  if (body.error) return `ERROR: ${JSON.stringify(body.error).slice(0, 400)}`
  const content = body.result?.content?.map((c) => c.text ?? '').join('\n') ?? JSON.stringify(body.result ?? {})
  return content.slice(0, 4000)
}

/** Run every verifier. A verifier whose SQL the server rejects (malformed query in the task data —
 *  e.g. a column that doesn't exist) is EXCLUDED from `total`, never counted as a fail: that is a
 *  data defect, not the agent's. `total` is the count that actually ran; a task where every
 *  verifier errors is unscoreable (`total === 0`) and the caller skips it. */
async function runVerifiers(task: GymTask): Promise<{ passes: number; total: number; errored: number }> {
  let passes = 0
  let total = 0
  let errored = 0
  for (const v of task.verifiers) {
    const server = task.servers.find((s) => s.mcp_server_name === v.gym_name) ?? task.servers[0]!
    const url = `${server.mcp_server_url.replace(/\/$/, '')}/api/sql-runner`
    try {
      const raw = await httpPost(url, { query: v.validation_config.query, database_id: server._database_id }, headersFor(server))
      const body = parseBody(raw) as { data?: Array<Record<string, unknown>> }
      const row = body.data?.[0]
      const actual = row ? Object.values(row)[0] : undefined
      total += 1
      if (compare(actual, v.validation_config.expected_value, v.validation_config.comparison_type)) passes += 1
    } catch (e) {
      // A transport failure (server down) IS fatal; a 4xx (bad verifier SQL) is excluded.
      if (e instanceof HttpError && e.status >= 400 && e.status < 500) errored += 1
      else throw e
    }
  }
  return { passes, total, errored }
}

function compare(actual: unknown, expected: unknown, cmp: string): boolean {
  const a = Number(actual)
  const e = Number(expected)
  const numeric = !Number.isNaN(a) && !Number.isNaN(e)
  if (cmp === 'equals') return numeric ? a === e : String(actual) === String(expected)
  if (cmp === 'greater_than') return a > e
  if (cmp === 'less_than') return a < e
  if (cmp === 'contains') return String(actual).includes(String(expected))
  throw new Error(`unsupported comparison_type ${cmp}`)
}

export interface RunGymShotOptions {
  routerBaseUrl: string
  routerKey: string
  model: string
  gymDbsDir: string
  maxTurns?: number
  temperature?: number
}

/** Run ONE agentic shot: seed → tool-calling loop → verify → cleanup. */
export async function runGymAgentShot(task: GymTask, opts: RunGymShotOptions): Promise<GymShotResult> {
  const maxTurns = opts.maxTurns ?? 12
  const server = task.servers[0]!
  await seed(server, opts.gymDbsDir)
  let turns = 0
  let toolCalls = 0
  let toolErrors = 0
  try {
    const tools = await loadTools(server, task.selectedTools)
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: task.systemPrompt },
      {
        role: 'user',
        content:
          `${task.userPrompt}\n\n` +
          'Use the available tools to bring the system to the required final state. Address EVERY ' +
          'distinct change the request implies, not just the first. After each tool result, check ' +
          'what remains and continue. Re-read the values you set back to confirm they took. Only ' +
          'reply DONE once every required change is made and verified — partial completion is a failure.',
      },
    ]
    for (turns = 0; turns < maxTurns; turns += 1) {
      const res = await fetch(`${opts.routerBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.routerKey}` },
        body: JSON.stringify({ model: opts.model, messages, tools, tool_choice: 'auto', temperature: opts.temperature ?? 0.7 }),
      })
      if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>
      }
      const msg = data.choices?.[0]?.message
      if (!msg) break
      const calls = msg.tool_calls ?? []
      messages.push({ role: 'assistant', content: msg.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) })
      if (calls.length === 0) break // the agent stopped calling tools — shot complete
      for (const call of calls) {
        toolCalls += 1
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.function.arguments || '{}')
        } catch {
          toolErrors += 1
        }
        let result: string
        try {
          result = await callTool(server, call.function.name, args)
          if (result.startsWith('ERROR:')) toolErrors += 1
        } catch (e) {
          toolErrors += 1
          result = `ERROR: ${e instanceof Error ? e.message : String(e)}`
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
    }
    const { passes, total, errored } = await runVerifiers(task)
    return {
      passes,
      total,
      score: total > 0 ? passes / total : 0,
      resolved: total > 0 && passes === total,
      turns,
      toolCalls,
      toolErrors,
      verifierErrors: errored,
      unscoreable: total === 0,
    }
  } finally {
    await deleteDb(server)
  }
}
