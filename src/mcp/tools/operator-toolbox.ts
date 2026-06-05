/**
 * @experimental
 *
 * The OPERATOR TOOLBOX — the driver's verbs, as MCP tools backed by a live keystone `Scope`.
 *
 * This is `Scope`-as-MCP: it exposes the operator verbs a DRIVER profile uses to lead the workers it
 * drives, so a coding-harness agent running *in a sandbox* can BE the driver (it calls these tools)
 * exactly as the in-process operator calls the `Scope` methods directly. Same verbs, two bindings.
 *
 *   spawn_worker  → scope.spawn   (budget-bounded, fail-closed — equal-k holds even for an LLM driver)
 *   observe_worker→ scope.view + the result blob (a worker's status, spend, and settled output)
 *   steer_worker  → scope.send    (deliver a next-instruction / interrupt to a RUNNING worker)
 *   stop          → declare the run complete (the driver's terminal move)
 *
 * `run_analyst` is intentionally NOT here yet: the analyst directory (agent-eval's
 * `createTraceAnalystKind` kinds) is the next piece — `run_analyst(kind, worker)` will dispatch over
 * that directory through `createScopeAnalyst`. The four verbs above are the ones whose keystone
 * backing already exists.
 *
 * A worker the driver spawns may itself carry the driver profile — `spawn_worker` does not care what
 * the profile is, so drivers-of-drivers fall out for free (each sub-driver gets its own sub-scope,
 * bounded by `maxDepth` + the conserved pool).
 */

import type { Budget, ResultBlobStore, Scope, Agent as SuperviseAgent } from '../../loops'
import type { McpToolDescriptor } from '../server'

/** How a `spawn_worker` profile becomes a spawnable leaf `Agent`. The caller wires this (e.g. the
 *  surface registry turns a profile into a shot executor) so the toolbox stays domain-blind. */
export type MakeWorkerAgent = (profile: unknown) => SuperviseAgent<unknown, unknown>

export interface OperatorToolboxOptions {
  /** The DRIVER's live scope — spawn/observe/steer all act on this. */
  readonly scope: Scope<unknown>
  /** Result blobs, so `observe_worker` can rehydrate a settled worker's output. */
  readonly blobs: ResultBlobStore
  /** Turn a spawn_worker `profile` into a leaf agent (registry-resolved on spawn). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Per-worker conserved budget the driver reserves on each spawn. */
  readonly perWorker: Budget
}

export interface OperatorToolbox {
  /** MCP tools — register on an `McpServer`, or call the handlers directly in-process. */
  readonly tools: McpToolDescriptor[]
  /** True once the driver called `stop` — the operator loop reads this to terminate. */
  isStopped(): boolean
  /** The reason passed to `stop`, if any. */
  stopReason(): string | undefined
}

const idArg = { type: 'string', description: 'The workerId returned by spawn_worker.' } as const

/** Build the operator toolbox over a live scope. The tools are the driver's verbs; their handlers
 *  are thin wrappers over the keystone (spawn/view/send), so the budget/journal/abort discipline of
 *  the Supervisor applies to a sandbox driver exactly as to the in-process one. */
export function createOperatorToolbox(opts: OperatorToolboxOptions): OperatorToolbox {
  let stopped = false
  let reason: string | undefined

  const str = (v: unknown, field: string): string => {
    if (typeof v !== 'string' || v.length === 0)
      throw new Error(`operator toolbox: "${field}" must be a non-empty string`)
    return v
  }
  const obj = (raw: unknown): Record<string, unknown> => {
    if (!raw || typeof raw !== 'object')
      throw new Error('operator toolbox: arguments must be an object')
    return raw as Record<string, unknown>
  }

  const tools: McpToolDescriptor[] = [
    {
      name: 'spawn_worker',
      description:
        'Start a worker the operator will drive. `profile` is the worker (or another DRIVER — ' +
        'drivers-of-drivers are allowed); `task` is what it should do. Reserves the worker’s budget ' +
        'from the conserved pool and FAILS CLOSED when the pool is dry — so spawning "at will" is ' +
        'bounded by the budget. Returns { workerId } or { error: "budget-exhausted" | "depth-exceeded" }.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { description: 'The worker/driver profile to run (passed to makeWorkerAgent).' },
          task: { description: 'The task the worker should perform.' },
          label: { type: 'string', description: 'Optional trace label.' },
        },
        required: ['profile', 'task'],
      },
      handler: (raw) => {
        const a = obj(raw)
        const agent = opts.makeWorkerAgent(a.profile)
        const res = opts.scope.spawn(agent, a.task, {
          budget: opts.perWorker,
          label: typeof a.label === 'string' ? a.label : 'worker',
        })
        return Promise.resolve(res.ok ? { workerId: res.handle.id } : { error: res.reason })
      },
    },
    {
      name: 'observe_worker',
      description:
        'Inspect a worker you are driving: its live status + conserved spend, and — once it has ' +
        'settled — its output artifact (rehydrated from the result blob). Use this to review work ' +
        'before deciding your next move. (In-flight token-level trace is surfaced via the analyst, ' +
        'not here.)',
      inputSchema: { type: 'object', properties: { workerId: idArg }, required: ['workerId'] },
      handler: async (raw) => {
        const id = str(obj(raw).workerId, 'workerId')
        const node = opts.scope.view.nodes.find((n) => n.id === id)
        if (!node) return { error: `unknown workerId ${JSON.stringify(id)}` }
        const output = node.outRef ? await opts.blobs.get(node.outRef) : undefined
        return {
          status: node.status,
          spent: node.spent,
          outRef: node.outRef ?? null,
          output: output ?? null,
        }
      },
    },
    {
      name: 'steer_worker',
      description:
        'Steer a RUNNING worker out-of-band — deliver your next instruction / a course-correction / ' +
        'an interrupt to its inbox. Returns { delivered } — false if the worker has finished or its ' +
        'harness cannot be steered mid-flight (then spawn a fresh one or wait and re-observe).',
      inputSchema: {
        type: 'object',
        properties: {
          workerId: idArg,
          instruction: { type: 'string', description: 'What the worker should do next.' },
        },
        required: ['workerId', 'instruction'],
      },
      handler: (raw) => {
        const a = obj(raw)
        const delivered = opts.scope.send(str(a.workerId, 'workerId'), {
          steer: str(a.instruction, 'instruction'),
        })
        return Promise.resolve({ delivered })
      },
    },
    {
      name: 'stop',
      description:
        'Declare the run complete — every required change is made and verified. The terminal move.',
      inputSchema: {
        type: 'object',
        properties: { reason: { type: 'string', description: 'Why you are stopping.' } },
      },
      handler: (raw) => {
        stopped = true
        const r = obj(raw).reason
        reason = typeof r === 'string' ? r : undefined
        return Promise.resolve({ stopped: true })
      },
    },
  ]

  return { tools, isStopped: () => stopped, stopReason: () => reason }
}
