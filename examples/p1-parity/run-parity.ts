/**
 * P1 parity CLI — replay N identical coding cells through `runMultishot` and `runGraph`, then
 * print paired records.
 *
 *   pnpm tsx examples/p1-parity/run-parity.ts --backend offline --cells 2 --shots 3
 *
 *   VB_CLI_BRIDGE_URL=http://127.0.0.1:3344/v1 VB_CLI_BRIDGE_BEARER=... \
 *   VB_PARITY_MODEL=pi/deepseek \
 *   VB_PARITY_ROUTER_URL=https://router.example/v1 VB_PARITY_ROUTER_KEY=... \
 *   VB_PARITY_DRIVER_MODEL=deepseek/deepseek-chat \
 *   pnpm tsx examples/p1-parity/run-parity.ts --backend cli-bridge --cells 1 --shots 3
 *
 * offline    — scripted seams (mirrors examples/graphs/shared.ts): zero network, zero env, $0.
 *              Shot script per cell: fail × (shots−1), then pass — so the graph arm settles on
 *              the final shot while the multishot arm burns its whole budget, and the paired records
 *              show exactly that. This mode is CI-safe and is what the vitest suite exercises.
 * cli-bridge — the LIVE entry. Nothing in this repo's gates ever executes it.
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
    // brain, and the driver model is substrate config (multishot backend / graph RouterConfig).
    coderProfile: {
      name: 'coder',
      harness: 'cli-base',
      model: {
        provider: 'scripted',
        default: 'scripted/parity-coder',
        metadata: { temperature: 0.7, maxTokens: 2500 },
      },
      prompt: { systemPrompt: 'Make tests pass.' },
    },
    reviewerProfile: {
      name: 'reviewer',
      harness: 'cli-base',
      model: {
        provider: 'scripted',
        default: 'scripted/parity-reviewer',
        metadata: { temperature: 0.9, maxTokens: 600 },
      },
      prompt: { systemPrompt: 'Verify.' },
    },
    shots,
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }
}

/** The live cell: same shape, with BOTH models from the environment and the marker contract the
 *  live completion check reads (see {@link LIVE_PASS_MARKER}). */
function liveParityCell(index: number, shots: number, env: LiveEnv): CellSpec {
  const base = parityCell(index, shots)
  return {
    ...base,
    coderProfile: {
      ...base.coderProfile,
      model: {
        ...base.coderProfile.model,
        provider: 'cli-bridge',
        default: env.coderModel,
      },
      prompt: {
        systemPrompt:
          'Make tests pass. Print the exact line ' +
          `'${LIVE_PASS_MARKER}' when and ONLY when the full suite genuinely passes.`,
      },
    },
    reviewerProfile: {
      ...base.reviewerProfile,
      model: {
        ...base.reviewerProfile.model,
        provider: 'tangle-router',
        default: env.driverModel,
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
    if (req.temperature !== metadata.temperature || req.maxTokens !== metadata.maxTokens) {
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
        { messages: req.messages as Array<Record<string, unknown>> },
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

/** LIVE completion check: a marker oracle, pending a real verifier lens. The coder profile must
 *  instruct the harness to print this marker only when the suite genuinely passes. */
const LIVE_PASS_MARKER = 'ALL TESTS PASS'
const livePassed = (text: string): boolean => text.includes(LIVE_PASS_MARKER)

function liveBackends(
  env: LiveEnv,
  cell: CellSpec,
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
      shotPassed: livePassed,
      apiKey: env.bearer,
      baseUrl: env.url,
    },
    graph: {
      kind: 'chat',
      url: env.url,
      bearer: env.bearer,
      router: { routerBaseUrl: env.routerUrl, routerKey: env.routerKey },
      shotPassed: livePassed,
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
      cell = liveParityCell(i, cli.shots, env)
      const backends = liveBackends(env, cell)
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
  console.log('\nfull records (JSON):')
  console.log(JSON.stringify(rows, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
