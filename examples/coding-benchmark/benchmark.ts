/**
 * coding-benchmark — run ONE coding task across harnesses × baseline profiles ×
 * scenarios, with controlled tool use, validators-before-judge, real stats, and a
 * no-cheat firewall. Every moving part is an agent-runtime / agent-eval primitive.
 *
 *   # offline (no creds — uses the in-process box + a mock judge transport)
 *   pnpm tsx examples/coding-benchmark/benchmark.ts
 *
 *   # one tool preset / ensemble / more reps
 *   pnpm tsx examples/coding-benchmark/benchmark.ts --tools web --ensemble --reps 5
 *
 *   # live (real harness boxes + a real judge model)
 *   TANGLE_API_KEY=sk-... SANDBOX_BASE_URL=https://... \
 *     pnpm tsx examples/coding-benchmark/benchmark.ts --live
 *
 * The wiring below is the whole thing: build the profile axis, hand the matrix the
 * dispatch + the judge(s), run it, then compute pairwise stats. ~40 lines of glue.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  agentProfileId,
  type ChatClient,
  type ChatResponse,
  createChatClient,
} from '@tangle-network/agent-eval'
import {
  inMemoryCampaignStorage,
  type JudgeConfig,
  runProfileMatrix,
} from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { SandboxClient } from '@tangle-network/agent-runtime/loops'
import { codingDispatch } from './dispatch'
import { ensembleCodeJudge, type RubricDim, type RunArtifact, singleCodeJudge } from './eval'
import { type OfflineScript, offlineSandboxClient } from './offline-box'
import { harnessProfiles, type ToolPreset } from './profiles'
import { type CodingScenario, scenarios } from './scenarios'
import { pairwiseStats, renderStats } from './stats'

export interface BenchmarkOptions {
  live?: boolean
  ensemble?: boolean
  toolPreset?: ToolPreset
  reps?: number
}

// ── flags ───────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): BenchmarkOptions {
  const flag = (name: string) => argv.includes(`--${name}`)
  // A value is the token AFTER `--name`, but only when it is not itself a flag — so
  // `--reps --live` does NOT consume `--live` as reps' value (which would yield NaN);
  // it falls back instead. `opt` never swallows a following flag.
  const opt = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`)
    if (i < 0) return fallback
    const v = argv[i + 1]
    return v && !v.startsWith('--') ? v : fallback
  }
  // Clamp reps to a positive integer — a non-numeric or <1 value is a usage error, not
  // a silent 0/NaN rep count that produces an empty matrix.
  const repsRaw = Math.floor(Number(opt('reps', '1')))
  const reps = Number.isFinite(repsRaw) && repsRaw >= 1 ? repsRaw : 1
  return {
    live: flag('live'),
    ensemble: flag('ensemble'),
    toolPreset: opt('tools', 'none') as ToolPreset,
    reps,
  }
}

// ── the offline "agent": a scripted, REFINING solution per scenario ───────────
// Offline we don't have a model, so each scenario's box writes a canned solution.
// `rate-limiter` IMPROVES across rounds (round 0 = a genuinely hollow `return true`
// stub the realness gate GATES to composite 0; round 1+ = the real token-bucket) —
// a real refine demo that fires the anti-cheat gate on the benchmark's OWN data.
// `csv-parser` writes its real implementation from round 0.
export const offlineSolutions: Record<string, OfflineScript> = {
  'rate-limiter': {
    path: 'src/rate-limiter.ts',
    solutionFor: (round) =>
      round === 0
        ? // round 0 — a genuinely HOLLOW stub: it accepts the constructor args (so the
          // hidden test instantiates it) but the body is pure cheat — `tryRemove` is a
          // hardcoded `return true` with NO refill math and NO use of the args. The
          // realness gate's `realImpl` signal does not fire (no `Date.now`/`refill`),
          // `fakeShim` does, so gateRealness GATES it → composite 0. The param names are
          // intentionally inert (no `refill` token) so the stub is hollow, not a real
          // impl that merely "happens to return true". (Verified by the smoke test.)
          `export class RateLimiter {\n  constructor(_capacity: number, _ratePerSec: number) {}\n` +
          `  tryRemove(n: number): boolean { return true }\n}\n`
        : // round 1+ — the real token-bucket with continuous time-based refill.
          `export class RateLimiter {\n  private tokens: number\n  private last = Date.now()\n` +
          `  constructor(private capacity: number, private refillPerSec: number) { this.tokens = capacity }\n` +
          `  tryRemove(n: number): boolean {\n    const now = Date.now()\n` +
          `    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec)\n` +
          `    this.last = now\n    if (n > this.tokens) return false\n    this.tokens -= n\n    return true\n  }\n}\n`,
  },
  'csv-parser': {
    path: 'src/csv.ts',
    solutionFor: () =>
      `export function parseCsv(input: string): string[][] {\n  const rows: string[][] = []\n` +
      `  let row: string[] = []\n  let field = ''\n  let inQuotes = false\n` +
      `  for (let i = 0; i < input.length; i++) {\n    const c = input.charAt(i)\n` +
      `    if (inQuotes) {\n      if (c === '"' && input.charAt(i + 1) === '"') { field += '"'; i++ }\n` +
      `      else if (c === '"') inQuotes = false\n      else field += c\n    } else if (c === '"') inQuotes = true\n` +
      `    else if (c === ',') { row.push(field); field = '' }\n` +
      `    else if (c === '\\n') { row.push(field); rows.push(row); row = []; field = '' }\n` +
      `    else field += c\n  }\n  row.push(field); rows.push(row)\n  return rows\n}\n`,
  },
  'lru-cache': {
    path: 'src/lru.ts',
    // Writes the real insertion-ordered-Map LRU from round 0 (the eviction logic is the
    // whole point; there is no honest hollow stub for this task). passes realness (85)
    // and the hidden eviction tests.
    solutionFor: () =>
      `export class LruCache<K, V> {\n  private map = new Map<K, V>()\n` +
      `  constructor(private capacity: number) {}\n` +
      `  get(key: K): V | undefined {\n    if (!this.map.has(key)) return undefined\n` +
      `    const v = this.map.get(key) as V\n    this.map.delete(key)\n    this.map.set(key, v)\n    return v\n  }\n` +
      `  set(key: K, value: V): void {\n    if (this.map.has(key)) this.map.delete(key)\n` +
      `    else if (this.map.size >= this.capacity) this.map.delete(this.map.keys().next().value as K)\n` +
      `    this.map.set(key, value)\n  }\n}\n`,
  },
}

// ── the box client: live (real harness) or offline (in-process) ───────────────
function clientFor(
  live: boolean,
  RealClient: (new (opts: { apiKey: string; baseUrl: string }) => unknown) | undefined,
): (scenario: CodingScenario) => (profile: AgentProfile) => SandboxClient {
  return (scenario) => {
    if (live) {
      const apiKey = process.env.TANGLE_API_KEY
      const baseUrl = process.env.SANDBOX_BASE_URL
      if (!apiKey || !baseUrl) throw new Error('--live needs TANGLE_API_KEY + SANDBOX_BASE_URL')
      if (!RealClient) throw new Error('@tangle-network/sandbox not loaded')
      return () => new RealClient({ apiKey, baseUrl }) as unknown as SandboxClient
    }
    const script = offlineSolutions[scenario.id]
    if (!script) throw new Error(`no offline script for scenario ${scenario.id}`)
    return () => offlineSandboxClient(script)
  }
}

// ── the judge transport: a real router (live) or a deterministic mock (offline) ─
// Offline the mock handler returns a fixed rubric verdict so the pipeline runs with
// no creds. Live, `createChatClient({ transport: 'router', apiKey })` calls the real
// router. The SAME `singleCodeJudge` / `ensembleCodeJudge` wiring runs either way.
function judgeChat(live: boolean): ChatClient {
  if (live) {
    const apiKey = process.env.TANGLE_API_KEY
    if (!apiKey) throw new Error('--live needs TANGLE_API_KEY for the judge router')
    return createChatClient({
      transport: 'router',
      apiKey,
      ...(process.env.TANGLE_ROUTER_URL ? { baseUrl: process.env.TANGLE_ROUTER_URL } : {}),
      defaultModel: process.env.JUDGE_MODEL ?? 'openai/gpt-4.1-2025-04-14',
    })
  }
  const verdict = JSON.stringify({
    dimensions: { correctness: 0.85, completeness: 0.8, code_quality: 0.8, robustness: 0.75 },
    notes: 'offline mock judge',
  })
  return createChatClient({
    transport: 'mock',
    defaultModel: 'mock-judge',
    handler: async (): Promise<ChatResponse> => ({
      content: verdict,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      costUsd: 0,
      model: 'mock-judge',
      durationMs: 0,
      raw: {},
    }),
  })
}

function judges(
  opts: BenchmarkOptions,
  chat: ChatClient,
): JudgeConfig<RunArtifact, CodingScenario>[] {
  if (opts.ensemble) {
    // The ensemble scores each panel model through the SAME chat transport — offline
    // that is the mock, live it is the router. It sees the SAME full context the
    // single judge does.
    const scoreOne = async (model: string, context: string): Promise<Record<RubricDim, number>> => {
      const res = await chat.chat({ model, messages: [{ role: 'user', content: context }] })
      const parsed = JSON.parse(res.content) as { dimensions: Record<RubricDim, number> }
      return parsed.dimensions
    }
    return [ensembleCodeJudge(scoreOne)]
  }
  return [singleCodeJudge(chat)]
}

// ── the sweep ─────────────────────────────────────────────────────────────────
export async function main(argv: string[] = process.argv.slice(2)): Promise<RunArtifactSummary> {
  const opts = parseArgs(argv)
  const live = opts.live ?? false
  const reps = opts.reps ?? 1
  const toolPreset = opts.toolPreset ?? 'none'
  const runDir = mkdtempSync(join(tmpdir(), 'coding-benchmark-'))

  // Lazy dynamic import so the offline path never needs the SDK or its creds. (This
  // is an ESM "type":"module" package — a top-level `require` would throw.)
  let RealClient: (new (o: { apiKey: string; baseUrl: string }) => unknown) | undefined
  if (live) {
    const sdk = (await import('@tangle-network/sandbox')) as {
      SandboxClient: new (o: never) => unknown
    }
    RealClient = sdk.SandboxClient as never
  }

  console.log(
    `coding-benchmark · ${live ? 'LIVE' : 'OFFLINE'} · tools=${toolPreset} · ` +
      `judges=${opts.ensemble ? '3 (ensemble)' : '1'} · reps=${reps} · ` +
      `harnesses=${harnessProfiles.length} · scenarios=${scenarios.length}`,
  )

  const chat = judgeChat(live)
  const resolveClient = clientFor(live, RealClient)

  try {
    // The matrix runs one campaign per profile. The dispatch is per-scenario only in
    // its CLIENT (offline scripts differ by scenario), so run each scenario's matrix
    // and merge the records. (Live, one client serves all scenarios — collapse this.)
    const allRecords = []
    for (const scenario of scenarios) {
      const result = await runProfileMatrix<CodingScenario, RunArtifact>({
        profiles: harnessProfiles, // axis: harness × baseline
        scenarios: [scenario], // axis: tasks (one at a time so the offline client matches)
        dispatch: codingDispatch(toolPreset, resolveClient(scenario)),
        judges: judges(opts, chat),
        reps,
        integrity: live ? 'assert' : 'off', // offline mock has no real backend; live proves it
        costCeiling: 5,
        runDir,
        commitSha: process.env.GIT_SHA ?? 'example',
        storage: inMemoryCampaignStorage(),
      })
      allRecords.push(...result.records)
    }

    // Map the matrix's hashed profileId → the readable harness name for the leaderboard.
    const nameById = new Map(harnessProfiles.map((p) => [agentProfileId(p), p.name ?? 'unknown']))
    const nameOf = (id: string) => nameById.get(id) ?? id
    const report = pairwiseStats(allRecords, nameOf)

    console.log(`\nrecords: ${allRecords.length}\n`)
    console.log(renderStats(report))
    return { records: allRecords.length, leaderboard: report.leaderboard.length }
  } finally {
    // The matrix writes its run artifacts under `runDir`; tear the temp tree down so
    // repeated runs don't leak `/tmp/coding-benchmark-*` directories.
    rmSync(runDir, { recursive: true, force: true })
  }
}

export interface RunArtifactSummary {
  records: number
  leaderboard: number
}

// Run only when invoked directly (not when imported by the smoke test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
    process.exit(1)
  })
}
