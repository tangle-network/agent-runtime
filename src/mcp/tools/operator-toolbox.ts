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
 *   await_next    → scope.next    (THE wake event: block until the next spawned worker settles)
 *   observe_worker→ scope.view + the result blob (a worker's status, spend, and settled output)
 *   steer_worker  → scope.send    (deliver a next-instruction / interrupt to a RUNNING worker)
 *   list_analysts → the lens menu  (the analyst kinds the driver can apply — see analyst-kinds.ts)
 *   run_analyst   → apply a LENS   (run a kind over a worker's trace → trace-derived findings)
 *   stop          → declare the run complete (the driver's terminal move)
 *
 * The analyst verbs are present only when the analyst seam (`analystKinds` + `runAnalyst`) is wired —
 * a driver that does not review traces (a pure dispatcher) omits them. The analyst is a SEPARATE lens
 * (selector ≠ judge: it reads the trace, never the score); `define_analyst` — authoring a NEW kind at
 * runtime — is the next addition.
 *
 * A worker the driver spawns may itself carry the driver profile — `spawn_worker` does not care what
 * the profile is, so drivers-of-drivers fall out for free (each sub-driver gets its own sub-scope,
 * bounded by `maxDepth` + the conserved pool).
 */

import type { Budget, ResultBlobStore, Scope, Settled, Agent as SuperviseAgent } from '../../loops'
import type { McpToolDescriptor } from '../server'

/** A worker the driver has drained via `await_next` — the operator's running ledger of settled
 *  workers + their DEPLOYABLE verdict (the driver IS the selector, so it legitimately reads the
 *  verdict; the analyst, which reads only the trace, is the separate selector≠judge lens). The
 *  driver picks its deliverable from this ledger at `stop`. */
export interface SettledWorker {
  readonly id: string
  readonly status: 'done' | 'down'
  /** Deployable score in [0,1] from the worker's verdict (done only). */
  readonly score?: number
  /** Whether the deployable verdict passed (done only). */
  readonly valid?: boolean
  /** Result-blob pointer for the worker's output/trace (done only). */
  readonly outRef?: string
  /** Failure reason (down only). */
  readonly reason?: string
}

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
  /** The analyst lens menu (for `list_analysts`) — id + one-line + area. Injected so the toolbox
   *  stays domain-blind; wire it from `analyst-kinds.ts`'s directory. Omit to disable analyst tools. */
  readonly analystKinds?: ReadonlyArray<{ id: string; description: string; area: string }>
  /** Run a lens over a worker's trace → findings (or a typed error). Wire it from
   *  `makeAnalystRunner(...)`. `run_analyst` fetches the worker's settled output and passes it here. */
  readonly runAnalyst?: (kindId: string, trace: unknown) => Promise<unknown>
}

export interface OperatorToolbox {
  /** MCP tools — register on an `McpServer`, or call the handlers directly in-process. */
  readonly tools: McpToolDescriptor[]
  /** True once the driver called `stop` — the operator loop reads this to terminate. */
  isStopped(): boolean
  /** The reason passed to `stop`, if any. */
  stopReason(): string | undefined
  /** The workers drained so far via `await_next` (the driver's selection ledger). */
  settled(): ReadonlyArray<SettledWorker>
}

const idArg = { type: 'string', description: 'The workerId returned by spawn_worker.' } as const

/** Build the operator toolbox over a live scope. The tools are the driver's verbs; their handlers
 *  are thin wrappers over the keystone (spawn/view/send), so the budget/journal/abort discipline of
 *  the Supervisor applies to a sandbox driver exactly as to the in-process one. */
export function createOperatorToolbox(opts: OperatorToolboxOptions): OperatorToolbox {
  let stopped = false
  let reason: string | undefined
  const ledger: SettledWorker[] = []

  const recordSettled = (s: Settled<unknown>): SettledWorker => {
    const w: SettledWorker =
      s.kind === 'done'
        ? {
            id: s.handle.id,
            status: 'done',
            score: s.verdict?.score ?? 0,
            valid: s.verdict?.valid ?? false,
            outRef: s.outRef,
          }
        : { id: s.handle.id, status: 'down', reason: s.reason }
    ledger.push(w)
    return w
  }

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
      name: 'await_next',
      description:
        'Wait for the next worker you spawned to FINISH, then read its deployable verdict. This is ' +
        'how you advance: spawn one or more workers, then call await_next to block until the next ' +
        'one settles. Returns { settled: workerId, status: "done"|"down", score, valid } for a ' +
        'finished worker, or { idle: true } when no worker is still running (then spawn more or stop). ' +
        'Workers run concurrently — spawn a batch, then await_next repeatedly to collect them.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const s = await opts.scope.next()
        if (!s) return { idle: true }
        const w = recordSettled(s)
        return w.status === 'done'
          ? { settled: w.id, status: 'done', score: w.score, valid: w.valid }
          : { settled: w.id, status: 'down', reason: w.reason }
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

  // list_analysts / run_analyst — present only when the analyst seam is wired. The driver picks a
  // kind from the menu and applies it to a worker it is driving; findings are trace-derived (the
  // firewall lives in the runner). (define_analyst — authoring a NEW kind at runtime — is deferred.)
  if (opts.analystKinds) {
    tools.push({
      name: 'list_analysts',
      description:
        'List the trace-analyst lenses available to run over a worker — id, what each looks for, and its area.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => Promise.resolve({ analysts: opts.analystKinds }),
    })
  }
  if (opts.runAnalyst) {
    tools.push({
      name: 'run_analyst',
      description:
        'Apply an analyst LENS to a worker you are driving — run `kind` over the worker’s trace and ' +
        'return its findings (trace-derived, never score-derived). Use `list_analysts` for the menu; ' +
        'run several lenses to triangulate. The worker must have settled (its trace is read from its output).',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'The analyst kind id (see list_analysts).' },
          workerId: idArg,
        },
        required: ['kind', 'workerId'],
      },
      handler: async (raw) => {
        const a = obj(raw)
        const id = str(a.workerId, 'workerId')
        const node = opts.scope.view.nodes.find((n) => n.id === id)
        if (!node) return { error: `unknown workerId ${JSON.stringify(id)}` }
        if (!node.outRef)
          return { error: `worker ${JSON.stringify(id)} has not settled — no trace to analyze yet` }
        const trace = await opts.blobs.get(node.outRef)
        return { findings: await opts.runAnalyst?.(str(a.kind, 'kind'), trace) }
      },
    })
  }

  return { tools, isStopped: () => stopped, stopReason: () => reason, settled: () => ledger }
}
