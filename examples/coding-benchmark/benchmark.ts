/**
 * coding-benchmark — run ONE coding task across harnesses × baseline profiles ×
 * scenarios, with controlled tool use, validators-before-judge, real stats, and a
 * no-cheat firewall. Every moving part is an agent-runtime / agent-eval primitive.
 *
 *   # offline (no creds — uses the in-process box + stub judge)
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

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  inMemoryCampaignStorage,
  type JudgeConfig,
  runProfileMatrix,
} from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { SandboxClient } from '@tangle-network/agent-runtime/loops'
import { codingDispatch } from './dispatch'
import { type CompleteFn, ensembleCodeJudge, type RubricDim, singleCodeJudge } from './judges'
import { type OfflineScript, offlineSandboxClient } from './offline-box'
import { harnessProfiles } from './profiles'
import { type CodingScenario, scenarios } from './scenarios'
import { pairwiseStats, renderStats } from './stats'
import type { ToolPreset } from './tools'
import type { RunArtifact } from './validators'

// ── flags ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fallback
}
const live = flag('live')
const ensemble = flag('ensemble')
const toolPreset = opt('tools', 'none') as ToolPreset
const reps = Number(opt('reps', '1'))

// ── the offline "agent": a scripted solution per scenario ─────────────────────
// Offline we don't have a model, so each scenario's box writes a canned, REAL
// implementation. (Swap in a `stub` to watch the realness validator catch it.)
const offlineSolutions: Record<string, OfflineScript> = {
  'rate-limiter': {
    path: 'src/rate-limiter.ts',
    solutionFor: () =>
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
}

// ── the box client: live (real harness) or offline (in-process) ───────────────
function clientFor(scenario: CodingScenario): (profile: AgentProfile) => SandboxClient {
  if (live) {
    // Real Tangle sandbox — one real harness box per cell. (Lazy import so the
    // offline path never needs the SDK creds.)
    const apiKey = process.env.TANGLE_API_KEY
    const baseUrl = process.env.SANDBOX_BASE_URL
    if (!apiKey || !baseUrl) throw new Error('--live needs TANGLE_API_KEY + SANDBOX_BASE_URL')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SandboxClient: RealClient } = require('@tangle-network/sandbox')
    return () => new RealClient({ apiKey, baseUrl }) as unknown as SandboxClient
  }
  const script = offlineSolutions[scenario.id]
  if (!script) throw new Error(`no offline script for scenario ${scenario.id}`)
  return () => offlineSandboxClient(script)
}

// ── the judge(s): one model, or a 3-model cross-family ensemble ───────────────
// Offline the model caller is a deterministic stub (so the pipeline runs with no
// creds). Live, point `complete` / `scoreOne` at your router.
const stubComplete: CompleteFn = async () =>
  JSON.stringify({
    correctness: 0.85,
    completeness: 0.8,
    code_quality: 0.8,
    robustness: 0.75,
    notes: 'stub',
  })

const stubScoreOne = async (): Promise<Record<RubricDim, number>> => ({
  correctness: 0.85,
  completeness: 0.8,
  code_quality: 0.8,
  robustness: 0.75,
})

function judges(): JudgeConfig<RunArtifact, CodingScenario>[] {
  if (ensemble) {
    // ensembleCodeJudge returns JudgeConfig<unknown>; the matrix accepts it on
    // any artifact — cast to the cell artifact type for the typed judges array.
    return [ensembleCodeJudge(stubScoreOne) as unknown as JudgeConfig<RunArtifact, CodingScenario>]
  }
  return [singleCodeJudge(stubComplete)]
}

// ── the sweep ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const runDir = mkdtempSync(join(tmpdir(), 'coding-benchmark-'))
  console.log(
    `coding-benchmark · ${live ? 'LIVE' : 'OFFLINE'} · tools=${toolPreset} · ` +
      `judges=${ensemble ? '3 (ensemble)' : '1'} · reps=${reps} · ` +
      `harnesses=${harnessProfiles.length} · scenarios=${scenarios.length}`,
  )

  // The matrix runs one campaign per profile. The dispatch is per-scenario only in
  // its CLIENT (offline scripts differ by scenario), so run each scenario's matrix
  // and merge the records. (Live, one client serves all scenarios — collapse this.)
  const allRecords = []
  for (const scenario of scenarios) {
    const result = await runProfileMatrix<CodingScenario, RunArtifact>({
      profiles: harnessProfiles, // axis: harness × baseline
      scenarios: [scenario], // axis: tasks (one at a time so the offline client matches)
      dispatch: codingDispatch(toolPreset, clientFor(scenario)),
      judges: judges(),
      reps,
      integrity: live ? 'assert' : 'off', // offline stub has no real backend; live proves it
      costCeiling: 5,
      runDir,
      commitSha: process.env.GIT_SHA ?? 'example',
      storage: inMemoryCampaignStorage(),
    })
    allRecords.push(...result.records)
  }

  console.log(`\nrecords: ${allRecords.length}\n`)
  console.log(renderStats(pairwiseStats(allRecords)))
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
