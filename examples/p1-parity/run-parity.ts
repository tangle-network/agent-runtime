/**
 * P1 parity CLI — replay N identical coding cells through `runMultishot` and `runGraph`, then
 * print paired records.
 *
 *   pnpm tsx examples/p1-parity/run-parity.ts --backend offline --cells 2 --shots 3
 *   pnpm tsx examples/p1-parity/run-parity.ts --backend cli-bridge --cells 1 --shots 3
 *
 * offline    — scripted seams (mirrors examples/graphs/shared.ts): zero network, zero env, $0.
 *              Shot script per cell: fail × (shots−1), then pass — so the graph arm settles on
 *              the final shot while the multishot arm burns its whole budget, and the paired records
 *              show exactly that. This mode is CI-safe and is what the vitest suite exercises.
 * cli-bridge — the LIVE one-command entry for later: wires the real cli-bridge backend from
 *              VB_CLI_BRIDGE_URL / VB_CLI_BRIDGE_BEARER (+ VB_PARITY_MODEL for the coder's
 *              bridge wire id). Nothing in this repo's gates ever executes it.
 */

import { parseArgs } from 'node:util'
import type { MultishotTransport } from '@tangle-network/agent-eval/multishot'
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
    coderProfile: { name: 'coder', prompt: { systemPrompt: 'Make tests pass.' } },
    reviewerProfile: { name: 'reviewer', prompt: { systemPrompt: 'Verify.' } },
    shots,
    budget: { maxIterations: 30, maxTokens: 100_000 },
  }
}

/** The live cell: same shape, plus the coder's bridge wire id and the marker contract the live
 *  completion check reads (see {@link LIVE_PASS_MARKER}). */
function liveParityCell(index: number, shots: number, model: string): CellSpec {
  const base = parityCell(index, shots)
  return {
    ...base,
    coderProfile: {
      ...base.coderProfile,
      model: { default: model },
      prompt: {
        systemPrompt:
          'Make tests pass. Print the exact line ' +
          `'${LIVE_PASS_MARKER}' when and ONLY when the full suite genuinely passes.`,
      },
    },
  }
}

// ── Live cli-bridge wiring (NOT executed by any gate — the later live entry) ───

interface BridgeEnv {
  url: string
  bearer: string
  model: string
}

function requireBridgeEnv(): BridgeEnv {
  const url = process.env.VB_CLI_BRIDGE_URL
  const bearer = process.env.VB_CLI_BRIDGE_BEARER
  const model = process.env.VB_PARITY_MODEL
  if (!url || !bearer || !model) {
    throw new Error(
      'cli-bridge backend needs VB_CLI_BRIDGE_URL, VB_CLI_BRIDGE_BEARER and VB_PARITY_MODEL ' +
        '(the coder bridge wire id, e.g. pi/deepseek) in the environment',
    )
  }
  return { url, bearer, model }
}

/** A multishot transport over cli-bridge's OpenAI-compatible chat-completions surface. */
function bridgeTransport(env: BridgeEnv): MultishotTransport {
  return async (req) => {
    const res = await fetch(`${env.url.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.bearer}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        ...(req.tools !== undefined && req.tools.length > 0 ? { tools: req.tools } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      }),
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    })
    if (!res.ok) {
      throw new Error(`cli-bridge completion failed: ${res.status} ${await res.text()}`)
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: never[] } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const message = body.choices?.[0]?.message
    if (message === undefined) throw new Error('cli-bridge completion returned no message')
    return { message, ...(body.usage !== undefined ? { usage: body.usage } : {}) }
  }
}

/** LIVE completion check: a marker oracle, pending a real verifier lens. The coder profile must
 *  instruct the harness to print this marker only when the suite genuinely passes. */
const LIVE_PASS_MARKER = 'ALL TESTS PASS'
const livePassed = (text: string): boolean => text.includes(LIVE_PASS_MARKER)

function liveBackends(env: BridgeEnv): {
  multishot: MultishotArmBackend
  graph: GraphArmBackend
} {
  const transport = bridgeTransport(env)
  return {
    multishot: {
      agentTransport: transport,
      driverTransport: transport,
      shotPassed: livePassed,
      apiKey: env.bearer,
      baseUrl: env.url,
    },
    graph: {
      kind: 'bridge',
      bridgeUrl: env.url,
      bridgeBearer: env.bearer,
      model: env.model,
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
      `tokens=${r.spend.tokens.input}/${r.spend.tokens.output} usd=${r.spend.usd} ` +
      `wallMs=${r.wallMs} steering=${r.steeringDelivered.count}×/${r.steeringDelivered.bytes}B ` +
      `ledger=${r.ledger === undefined ? 'none (runMultishot has no edge ledger)' : `${r.ledger.length} rows`}`,
  )
  if (r.ledger !== undefined) {
    for (const t of r.ledger) {
      const worker = t.workerId !== undefined ? ` -> ${t.workerId}` : ''
      const reason = t.reason !== undefined ? `  (${t.reason})` : ''
      console.log(`    #${t.traversal} ${t.edge} [${t.outcome}] ${t.bytes}B${worker}${reason}`)
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
      const env = requireBridgeEnv()
      const backends = liveBackends(env)
      cell = liveParityCell(i, cli.shots, env.model)
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
