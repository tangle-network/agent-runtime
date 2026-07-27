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
import {
  leaderboard,
  pairwiseSignificance,
  renderLeaderboardMarkdown,
  renderPairwiseMarkdown,
  type SandboxClient,
} from '@tangle-network/agent-runtime/loops'
import { codingDispatch } from './dispatch'
import { ensembleCodeJudge, type RubricDim, type RunArtifact, singleCodeJudge } from './eval'
import { csvParserSource, lruCacheSource } from './fixtures'
import { type OfflineScript, offlineSandboxClient } from './offline-box'
import { harnessProfiles, type ToolPreset } from './profiles'
import { type CodingScenario, scenarios } from './scenarios'

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

// ── the offline AGENT SCRIPTS: a scripted, REFINING solution per scenario ─────
// These stand in for a real coding agent ONLY offline (live, `--live` swaps a real harness box for
// the scripted client). `rate-limiter` is the one deliberate-CHEAT pair: round 0 is a
// HARDCODE-THE-VISIBLE cheat the held-out suite MUST catch (the smoke test asserts it fails held-out
// while round 1+'s real token-bucket passes — the anti-cheat, by execution). `csv-parser`/`lru-cache`
// have no honest hollow stub, so their offline agent writes the real impl from round 0 (source in
// fixtures.ts, kept out of this file so the one teaching pair stays readable).
export const offlineAgentScripts: Record<string, OfflineScript> = {
  'rate-limiter': {
    path: 'src/rate-limiter.ts',
    solutionFor: (round) =>
      round === 0
        ? // round 0 — a HARDCODE-THE-VISIBLE cheat: it replays the exact visible example
          // calls (cap 10/3/10, the specific draws + their call order) and returns canned
          // answers, with NO bucket math. It PASSES the visible tests but FAILS the
          // held-out suite (cap 7/6/5/2, different draws + edge cases it never saw),
          // caught by EXECUTION on inputs the cheat never memorized.
          `export class RateLimiter {
  private cap: number
  private refill: number
  private call = 0
  constructor(capacity: number, refillPerSec: number) { this.cap = capacity; this.refill = refillPerSec }
  tryRemove(_n: number): boolean {
    // hardcoded to the visible examples only — keyed on the exact (cap, refill)
    // pairs the visible tests use; no real bucket math.
    this.call++
    if (this.cap === 3) return false              // visible (3,1): draw 4 -> false
    if (this.cap === 10 && this.refill === 0) return this.call === 1 // visible (10,0): T,F
    return true                                   // visible (10,1): T,T
  }
}
`
        : // round 1+ — the real token-bucket with continuous time-based refill.
          `export class RateLimiter {
  private tokens: number
  private last = Date.now()
  constructor(private capacity: number, private refillPerSec: number) { this.tokens = capacity }
  tryRemove(n: number): boolean {
    const now = Date.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec)
    this.last = now
    if (n > this.tokens) return false
    this.tokens -= n
    return true
  }
}
`,
  },
  'csv-parser': { path: 'src/csv.ts', solutionFor: () => csvParserSource },
  'lru-cache': { path: 'src/lru.ts', solutionFor: () => lruCacheSource },
}

// ── the box client: live (real harness) or offline (in-process) ───────────────
type SandboxSdkConstructor = new (options: { apiKey: string; baseUrl: string }) => SandboxClient

function clientFor(
  live: boolean,
  SandboxSdk: SandboxSdkConstructor | undefined,
): (scenario: CodingScenario) => (profile: AgentProfile) => SandboxClient {
  return (scenario) => {
    if (live) {
      const apiKey = process.env.TANGLE_API_KEY
      const baseUrl = process.env.SANDBOX_BASE_URL
      if (!apiKey || !baseUrl) throw new Error('--live needs TANGLE_API_KEY + SANDBOX_BASE_URL')
      if (!SandboxSdk) throw new Error('@tangle-network/sandbox not loaded')
      return () => new SandboxSdk({ apiKey, baseUrl })
    }
    const script = offlineAgentScripts[scenario.id]
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
export async function main(argv: string[] = process.argv.slice(2)): Promise<BenchmarkSummary> {
  const opts = parseArgs(argv)
  const live = opts.live ?? false
  const reps = opts.reps ?? 1
  const toolPreset = opts.toolPreset ?? 'none'
  const runDir = mkdtempSync(join(tmpdir(), 'coding-benchmark-'))

  // Lazy dynamic import so the offline path never needs the SDK or its creds. (This
  // is an ESM "type":"module" package — a top-level `require` would throw.)
  let SandboxSdk: SandboxSdkConstructor | undefined
  if (live) {
    const { Sandbox } = await import('@tangle-network/sandbox')
    SandboxSdk = Sandbox
  }

  console.log(
    `coding-benchmark · ${live ? 'LIVE' : 'OFFLINE'} · tools=${toolPreset} · ` +
      `judges=${opts.ensemble ? '3 (ensemble)' : '1'} · reps=${reps} · ` +
      `harnesses=${harnessProfiles.length} · scenarios=${scenarios.length}`,
  )

  const chat = judgeChat(live)
  const resolveClient = clientFor(live, SandboxSdk)

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
    // The ONE report engine — same as webcode-matrix. Records tag `searchScore` (no split); the profile
    // key is the matrix's hashed id, labelled via nameOf. `stats` computes the Wilson + bootstrap CIs;
    // `pairwiseSignificance` runs the paired, BH-corrected who-beat-whom test (power floor 6 at this n).
    const keyOf = (r: { agentProfile?: { profileId?: string }; candidateId?: string }) =>
      r.agentProfile?.profileId ?? r.candidateId ?? 'unknown'
    const scoreOf = (r: { outcome: { searchScore?: number; holdoutScore?: number } }) =>
      r.outcome.searchScore ?? r.outcome.holdoutScore ?? 0
    const board = leaderboard(allRecords, {
      title: 'Coding benchmark — harness leaderboard',
      stats: true,
      passThreshold: 0.6,
      scoreOf,
      profileKeyOf: keyOf,
      labelOf: nameOf,
    })
    const pairs = pairwiseSignificance(allRecords, {
      scoreOf,
      profileKeyOf: keyOf,
      labelOf: nameOf,
      minPairs: 6,
    })

    console.log(`\nrecords: ${allRecords.length}\n`)
    console.log(renderLeaderboardMarkdown(board))
    console.log(`\n${renderPairwiseMarkdown(pairs)}`)
    return { records: allRecords.length, leaderboard: board.profiles.length }
  } finally {
    // The matrix writes its run artifacts under `runDir`; tear the temp tree down so
    // repeated runs don't leak `/tmp/coding-benchmark-*` directories.
    rmSync(runDir, { recursive: true, force: true })
  }
}

export interface BenchmarkSummary {
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
