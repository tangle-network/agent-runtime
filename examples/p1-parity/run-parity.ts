/**
 * P1 parity CLI — replay N identical coding cells through `runMultishot` and `runGraph`, then
 * print paired records.
 *
 *   pnpm tsx examples/p1-parity/run-parity.ts --backend offline --cells 2 --shots 3
 *
 *   VB_CLI_BRIDGE_URL=https://router.example/v1 VB_CLI_BRIDGE_BEARER=... \
 *   VB_PARITY_MODEL=glm-5.3 \
 *   VB_PARITY_ROUTER_URL=https://router.example/v1 VB_PARITY_ROUTER_KEY=... \
 *   VB_PARITY_DRIVER_MODEL=glm-5.3 \
 *   pnpm tsx examples/p1-parity/run-parity.ts --backend cli-bridge --cells 1 --shots 3
 *
 * offline    — scripted seams (mirrors examples/graphs/shared.ts): zero network, zero env, $0.
 *              Shot script per cell: fail × (shots−1), then pass — so the graph arm settles on
 *              the final shot while the multishot arm burns its whole budget, and the paired records
 *              show exactly that. This mode is CI-safe and is what the vitest suite exercises.
 * cli-bridge — the LIVE entry. Nothing in this repo's gates ever executes it. Cells come from
 *              {@link LIVE_TASK_FAMILY}: count-and-positions tasks whose ground truth the harness
 *              computes, so the deliverable check is a deployable text oracle (exactly one
 *              matching ANSWER line), identical in both arms. `VB_CLI_BRIDGE_URL` names ANY
 *              OpenAI-compatible `/v1` both arms' coders share — a cli-bridge or the router
 *              itself; substrate symmetry needs only that it is the SAME endpoint + model.
 *
 * LIVE SUBSTRATE SYMMETRY (the validity invariant, per #710/#721). Both arms' coders are a conversation
 * on the SAME bare OpenAI-compatible `/v1/chat/completions` endpoint (`VB_CLI_BRIDGE_URL`) with
 * the SAME wire model (`VB_PARITY_MODEL`): the multishot arm posts through `runMultishot`'s
 * transport seam, the graph arm runs `chatTransportExecutor` via `chatWorkerSeam` — with the
 * delegates edge's `continuity: 'resume'` continuing ONE session across shots exactly as
 * `runMultishot`'s single transcript does. Both arms' REVIEWERS likewise share a substrate: the
 * multishot driver leg posts to the router endpoint (`VB_PARITY_ROUTER_URL`) with
 * `VB_PARITY_DRIVER_MODEL`, and the graph arm's driver brain is `runGraph`'s router brain on the
 * same config. What remains different is exactly the treatment P1 measures: the orchestration
 * form (transcript loop vs supervised graph with edge ledger + conserved pool). Every model is
 * explicit — a missing env var fails loud; there is no silent fallback id.
 */

import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import type { MultishotTransport } from '@tangle-network/agent-eval/multishot'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  collectAgentTurn,
  createExecutor,
  streamAgentTurn,
  type ToolSpec,
} from '@tangle-network/agent-runtime/kernel'
import type { CellSpec, GraphArmBackend, MultishotArmBackend, ParityRecord } from './arms'
import { runGraphArm, runMultishotArm } from './arms'
import { offlineGraphBackend, offlineMultishotBackend } from './offline'

interface CliOptions {
  backend: 'offline' | 'cli-bridge'
  cells: number
  shots: number
}

function parseCli(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      backend: { type: 'string', default: 'offline' },
      cells: { type: 'string', default: '1' },
      shots: { type: 'string', default: '3' },
    },
  })
  const backend = values.backend
  if (backend !== 'offline' && backend !== 'cli-bridge') {
    throw new Error(`--backend must be offline|cli-bridge, got '${backend}'`)
  }
  const cells = Number.parseInt(values.cells ?? '1', 10)
  const shots = Number.parseInt(values.shots ?? '3', 10)
  if (!Number.isInteger(cells) || cells < 1) throw new Error(`--cells must be >= 1, got ${cells}`)
  if (!Number.isInteger(shots) || shots < 1) throw new Error(`--shots must be >= 1, got ${shots}`)
  return { backend, cells, shots }
}

// ── Cells ──────────────────────────────────────────────────────────────────────

function parityCell(index: number, shots: number): CellSpec {
  return {
    task: `parity cell ${index + 1}: make the failing test suite pass`,
    // The coder model is PINNED on its profile (the arms refuse a model-less coder — a silent
    // fallback could let the two arms drift apart); offline it names the scripted transport.
    // The reviewer profile stays model-less: as the graph ROOT it is materialized by the driver
    // brain, and the driver model comes from the exact root profile in both arms.
    coderProfile: {
      name: 'coder',
      harness: 'cli-base',
      model: {
        provider: 'scripted',
        default: 'scripted/parity-coder',
        metadata: { temperature: 0.7 },
        maxVisibleOutputTokens: 2500,
      },
      prompt: { systemPrompt: 'Make tests pass.' },
    },
    reviewerProfile: {
      name: 'reviewer',
      harness: 'cli-base',
      model: {
        provider: 'scripted',
        default: 'scripted/parity-reviewer',
        metadata: { temperature: 0.9 },
        maxVisibleOutputTokens: 600,
      },
      prompt: { systemPrompt: 'Verify.' },
    },
    shots,
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }
}

// ── The live task family: deterministic count-and-positions cells ──────────────
//
// The deliverable check must be a deployable oracle read off the coder's text, never the model
// judging itself. Each cell asks for the occurrence count AND every 1-based position of one
// character in one exact string; the harness computes the ground truth and the check demands
// exactly ONE well-formed answer line that matches it. Character indexing is genuinely
// error-prone for chat models, so shot 1 fails often enough to exercise the multi-shot path —
// the regime where the two orchestration forms can actually diverge.

interface LiveTask {
  readonly text: string
  readonly ch: string
}

/** Fixed family; `--cells N` runs the first N. Mixed length/density for a spread of difficulty. */
const LIVE_TASK_FAMILY: ReadonlyArray<LiveTask> = [
  { text: 'strawberry', ch: 'r' },
  { text: 'parallelizable', ch: 'l' },
  { text: 'mississippi riverbanks', ch: 's' },
  { text: 'indivisibility', ch: 'i' },
  { text: 'bookkeeping paraphernalia', ch: 'a' },
  { text: 'overengineering', ch: 'e' },
  { text: 'circumnavigation of the archipelago', ch: 'c' },
  { text: 'unconstitutionally', ch: 'n' },
]

/** Ground truth, computed by the harness — the one line a passing reply must contain. */
export function expectedAnswerLine(task: LiveTask): string {
  const positions: number[] = []
  for (let i = 0; i < task.text.length; i += 1) {
    if (task.text[i] === task.ch) positions.push(i + 1)
  }
  return `ANSWER: ${positions.length}@[${positions.join(',')}]`
}

/** Exactly one `ANSWER:` line, equal to the expected line — several candidate lines cannot
 *  shotgun the check, and prose around the line does not defeat it. */
export function liveShotPassed(expected: string): (text: string) => boolean {
  return (text) => {
    const answers = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('ANSWER:'))
    return answers.length === 1 && answers[0] === expected
  }
}

function liveTaskText(index: number, task: LiveTask, nonce: string): string {
  return (
    `counting cell ${index + 1} [run ${nonce}]: in the exact string '${task.text}', count the ` +
    `occurrences of the character '${task.ch}' and list every occurrence's 1-based position. ` +
    'Case-sensitive; every character including spaces occupies one position. End your reply ' +
    'with one line of the exact form: ANSWER: <count>@[<p1>,<p2>,...]'
  )
}

/** The live cell: the family task above, BOTH models from the environment, and the reviewer
 *  authored for both forms — its `systemPrompt` is the stance both arms share (the multishot
 *  driver leg reads only this), and its `instructions` carry the graph arm's tool protocol
 *  (`resolveSupervisorSystemPrompt` appends them for the root brain; `runMultishot` never sees
 *  them — orchestration in the loop form is code, in the graph form it is the supervisor). */
function liveParityCell(index: number, shots: number, env: LiveEnv, nonce: string): CellSpec {
  const base = parityCell(index, shots)
  const task = LIVE_TASK_FAMILY[index]
  if (task === undefined) {
    throw new Error(
      `--cells ${index + 1} exceeds the live task family (${LIVE_TASK_FAMILY.length} cells)`,
    )
  }
  return {
    ...base,
    task: liveTaskText(index, task, nonce),
    coderProfile: {
      ...base.coderProfile,
      model: {
        ...base.coderProfile.model,
        provider: 'openai-compat',
        default: env.coderModel,
      },
      prompt: {
        systemPrompt:
          'Solve the counting task exactly. Verify character by character, indexing every ' +
          'position, before you answer. Your reply must contain exactly one line starting with ' +
          "'ANSWER:', of the exact form ANSWER: <count>@[<p1>,<p2>,...] — no other line may " +
          'start with ANSWER:.',
      },
    },
    reviewerProfile: {
      ...base.reviewerProfile,
      model: {
        ...base.reviewerProfile.model,
        provider: 'tangle-router',
        default: env.driverModel,
      },
      prompt: {
        systemPrompt:
          'You are the reviewer driving a coder through repeated shots at a counting task. You ' +
          'never solve the task or state an answer yourself. Each round, issue one short ' +
          'corrective instruction: tell the coder to recount character by character, index ' +
          'every position, and restate its full reply ending with its final ANSWER line.',
        instructions: [
          "You supervise exactly ONE pinned worker node named 'coder'; the graph pins its full " +
            'profile. To run a shot call spawn_agent with arguments ' +
            '{"profile":{"name":"coder"},"task":"<brief>"} — never author any other profile.',
          "Shot 1's task must be the root task COPIED VERBATIM. After each spawn, call " +
            'await_event until that worker settles; the settle reports valid:true only when ' +
            'the deliverable check passed.',
          "valid:false → spawn 'coder' again with a short corrective brief (the session " +
            'resumes automatically). valid:true → stop calling tools and reply with a one-line ' +
            'summary.',
          `You may spawn 'coder' at most ${shots} times in total.`,
        ],
      },
    },
  }
}

// ── Live wiring (NOT executed by any gate — the live entry) ────────────────────

interface LiveEnv {
  /** The bare chat-completions endpoint BOTH arms' coders speak. */
  url: string
  bearer: string
  /** The coder wire model id, identical in both arms. */
  coderModel: string
  /** The router substrate BOTH arms' reviewers run on. */
  routerUrl: string
  routerKey: string
  driverModel: string
}

function requireLiveEnv(): LiveEnv {
  const read = {
    VB_CLI_BRIDGE_URL: process.env.VB_CLI_BRIDGE_URL,
    VB_CLI_BRIDGE_BEARER: process.env.VB_CLI_BRIDGE_BEARER,
    VB_PARITY_MODEL: process.env.VB_PARITY_MODEL,
    VB_PARITY_ROUTER_URL: process.env.VB_PARITY_ROUTER_URL,
    VB_PARITY_ROUTER_KEY: process.env.VB_PARITY_ROUTER_KEY,
    VB_PARITY_DRIVER_MODEL: process.env.VB_PARITY_DRIVER_MODEL,
  }
  const missing = Object.entries(read)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length > 0) {
    throw new Error(
      `cli-bridge backend: missing ${missing.join(', ')} — the coder endpoint/bearer/model ` +
        '(VB_CLI_BRIDGE_URL, VB_CLI_BRIDGE_BEARER, VB_PARITY_MODEL) and the reviewer router ' +
        'substrate (VB_PARITY_ROUTER_URL, VB_PARITY_ROUTER_KEY, VB_PARITY_DRIVER_MODEL) are all ' +
        'required; no model has a fallback',
    )
  }
  return {
    url: read.VB_CLI_BRIDGE_URL as string,
    bearer: read.VB_CLI_BRIDGE_BEARER as string,
    coderModel: read.VB_PARITY_MODEL as string,
    routerUrl: read.VB_PARITY_ROUTER_URL as string,
    routerKey: read.VB_PARITY_ROUTER_KEY as string,
    driverModel: read.VB_PARITY_DRIVER_MODEL as string,
  }
}

/** Adapt Eval's transcript request to Runtime's exact profile turn. No provider call bypasses
 * `createExecutor` + `streamAgentTurn`; request behavior must equal the declared profile. */
function completionsTransport(
  profile: AgentProfile,
  url: string,
  bearer: string,
): MultishotTransport {
  return async (req) => {
    if (req.model !== profile.model?.default) {
      throw new Error('P1 transport request model conflicts with its AgentProfile')
    }
    const metadata = profile.model?.metadata ?? {}
    if (
      req.temperature !== metadata.temperature ||
      req.maxTokens !== profile.model?.maxVisibleOutputTokens
    ) {
      throw new Error('P1 transport generation controls conflict with its AgentProfile')
    }
    const tools = (req.tools ?? []) as ToolSpec[]
    const factory = createExecutor({
      backend: 'router',
      routerBaseUrl: url,
      routerKey: bearer,
      ...(tools.length > 0 ? { tools } : {}),
    })
    const turn = await collectAgentTurn(
      streamAgentTurn(
        { kind: 'executor', factory, profile },
        {
          providerOptions: {
            messages: req.messages as Array<Record<string, unknown>>,
          },
        },
        req.signal ? { signal: req.signal } : {},
      ),
    )
    if (turn.status !== 'completed') {
      throw new Error(turn.error?.message ?? `P1 Runtime turn ended with ${turn.status}`)
    }
    return {
      message: {
        content: turn.finalText,
        ...(turn.toolCalls.length > 0
          ? {
              tool_calls: turn.toolCalls.map((call, index) => ({
                id: call.id ?? `call_${index}`,
                type: 'function' as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      },
      ...(turn.usage.tokensKnown === false
        ? {}
        : {
            usage: {
              prompt_tokens: turn.usage.input,
              completion_tokens: turn.usage.output,
            },
          }),
      ...(turn.usage.usdKnown === false || turn.usage.costUsd === undefined
        ? {}
        : { costUsd: turn.usage.costUsd }),
    }
  }
}

function liveBackends(
  env: LiveEnv,
  cell: CellSpec,
  shotPassed: (text: string) => boolean,
): {
  multishot: MultishotArmBackend
  graph: GraphArmBackend
} {
  return {
    multishot: {
      // Coder leg on the shared coder endpoint; reviewer (driver) leg on the shared router
      // substrate — each leg matching its graph-arm counterpart, including the driver model.
      agentTransport: completionsTransport(cell.coderProfile, env.url, env.bearer),
      driverTransport: completionsTransport(cell.reviewerProfile, env.routerUrl, env.routerKey),
      shotPassed,
    },
    graph: {
      kind: 'chat',
      url: env.url,
      bearer: env.bearer,
      router: { routerBaseUrl: env.routerUrl, routerKey: env.routerKey },
      shotPassed,
      // Spawns + awaits + a final reply for the shot budget, with slack for re-reads; the
      // delegates cap, not this, owns the shot budget.
      maxTurns: cell.shots * 6 + 6,
    },
  }
}

// ── The run ────────────────────────────────────────────────────────────────────

interface PairedRow {
  cell: number
  arm: 'multishot' | 'graph'
  record: ParityRecord
}

function printRecord(row: PairedRow): void {
  const r = row.record
  console.log(
    `cell ${row.cell} ${row.arm.padEnd(5)} converged=${r.converged} shotsUsed=${r.shotsUsed} ` +
      `infraShots=${r.infraShots} tokens=${r.spend.tokens.input}/${r.spend.tokens.output} ` +
      `tokensKnown=${r.tokensKnown} usd=${r.spend.usd} usdSource=${r.usdSource} ` +
      `usdKnown=${r.usdKnown} wallMs=${r.wallMs} ` +
      `steering=${r.steeringDelivered.count}×/${r.steeringDelivered.bytes}B ` +
      `ledger=${r.ledger === undefined ? 'none (runMultishot has no edge ledger)' : `${r.ledger.length} rows`}`,
  )
  if (r.ledger !== undefined) {
    for (const t of r.ledger) {
      const worker = t.workerId !== undefined ? ` -> ${t.workerId}` : ''
      const reason = t.reason !== undefined ? `  (${t.reason})` : ''
      console.log(
        `    #${t.traversal} ${t.edge} [${t.outcome}|${t.continuity}] ${t.bytes}B${worker}${reason}`,
      )
    }
  }
}

export async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2))
  // One nonce per run, embedded in every live task text: the SAME text still reaches both arms
  // (input equivalence within a cell) while no prompt is byte-identical across runs, so an
  // upstream response cache cannot serve one run's completion to another.
  const runNonce = randomBytes(4).toString('hex')
  const rows: PairedRow[] = []
  for (let i = 0; i < cli.cells; i += 1) {
    let multishotBackend: MultishotArmBackend
    let graphBackend: GraphArmBackend
    let cell: CellSpec
    if (cli.backend === 'offline') {
      // fail × (shots−1) then pass: converges exactly on the final shot.
      const script = [...Array<'fail'>(cli.shots - 1).fill('fail'), 'pass' as const]
      cell = parityCell(i, cli.shots)
      multishotBackend = offlineMultishotBackend(script).backend
      graphBackend = offlineGraphBackend(cell, script).backend
    } else {
      const env = requireLiveEnv()
      const task = LIVE_TASK_FAMILY[i]
      if (task === undefined) {
        throw new Error(
          `--cells ${i + 1} exceeds the live task family (${LIVE_TASK_FAMILY.length})`,
        )
      }
      cell = liveParityCell(i, cli.shots, env, runNonce)
      const backends = liveBackends(env, cell, liveShotPassed(expectedAnswerLine(task)))
      multishotBackend = backends.multishot
      graphBackend = backends.graph
    }
    const multishot = await runMultishotArm(cell, multishotBackend)
    const graph = await runGraphArm(cell, graphBackend)
    rows.push({ cell: i + 1, arm: 'multishot', record: multishot })
    rows.push({ cell: i + 1, arm: 'graph', record: graph })
  }
  console.log(`p1-parity — backend=${cli.backend} cells=${cli.cells} shots=${cli.shots}\n`)
  for (const row of rows) printRecord(row)
  printParitySummary(rows, cli)
  console.log('\nfull records (JSON):')
  console.log(JSON.stringify(rows, null, 2))
}

/** Paired verdict per cell + the ledger audit: does the graph arm's edge ledger account for
 *  every traversal it claims (bound worker on every delivered delegates row, shot budget
 *  respected, shotsUsed = distinct bound workers)? */
function printParitySummary(rows: ReadonlyArray<PairedRow>, cli: CliOptions): void {
  console.log('\nparity summary (per cell):')
  for (let cell = 1; cell <= cli.cells; cell += 1) {
    const multishot = rows.find((r) => r.cell === cell && r.arm === 'multishot')?.record
    const graph = rows.find((r) => r.cell === cell && r.arm === 'graph')?.record
    if (!multishot || !graph) continue
    const agree = multishot.converged === graph.converged
    const ledger = graph.ledger ?? []
    const delegates = ledger.filter((t) => t.kind === 'delegates')
    const delivered = delegates.filter((t) => t.outcome === 'delivered')
    const boundWorkers = new Set(
      delivered.map((t) => t.workerId).filter((id): id is string => id !== undefined),
    )
    const unbound = delivered.filter((t) => t.workerId === undefined).length
    const ledgerAccounts =
      unbound === 0 && boundWorkers.size === graph.shotsUsed && boundWorkers.size <= cli.shots
    console.log(
      `cell ${cell}: converged multishot=${multishot.converged} graph=${graph.converged} ` +
        `${agree ? 'AGREE' : 'DIVERGE'} | shots ${multishot.shotsUsed} vs ${graph.shotsUsed} | ` +
        `ledger delegates=${delegates.length} delivered=${delivered.length} ` +
        `other=${delegates.filter((t) => t.outcome !== 'delivered').length} ` +
        `boundWorkers=${boundWorkers.size} accounts=${ledgerAccounts}`,
    )
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
