/**
 * Reference BrowserAgentAdapter for @tangle-network/browser-agent-driver (the `bad`
 * CLI). One of N pluggable drivers behind the neutral harness — it conforms to the
 * SAME BrowserAgentAdapter contract as a browser-use runner or any other agent.
 *
 * `bad run --cases <file> --sink <dir>` emits a structured report.json; we map its
 * `agentResult` to the neutral BrowserRun and let `judgeBrowserRun` derive the
 * DETERMINISTIC verdict. We record `bad`'s own success/goalVerification only as
 * `selfReportedSuccess` — it never decides the outcome (attestation, not trust).
 *
 * `badReportToRun` is a pure, unit-testable mapper kept separate from the spawn so
 * the report-shape mapping can be exercised without launching a browser.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserAgentAdapter, BrowserRun, BrowserStep, BrowserTask } from '../agent-adapter'

export interface BadAdapterConfig {
  /** Path to the bad CLI entry (default: $BAD_CLI or ~/code/browser-agent-driver/dist/cli.js). */
  badCli?: string
  model?: string
  provider?: string
  /** OpenAI-compatible endpoint — point at our router. */
  baseUrl?: string
  apiKey?: string
  maxTurns?: number
  timeoutMs?: number
  /** Capture a per-turn screenshot into each turn's state.screenshot (bad
   *  full-evidence mode). Off by default — opt in for the navigation film. */
  captureScreenshots?: boolean
}

interface BadReport {
  results?: Array<{
    testCase?: { id?: string }
    // Real token/cost telemetry (bad >=0.33 reports these per result) — forwarded to
    // BrowserRun so a real run never reads as a {0,0} backend-integrity stub.
    estimatedCostUsd?: number
    inputTokens?: number
    outputTokens?: number
    agentResult?: {
      success?: boolean
      result?: string
      turns?: Array<{
        turn?: number
        // state.screenshot is INLINE base64 (no data: prefix) — the durable frame
        // source for the film, since the adapter's temp sink is reaped after the run.
        state?: { url?: string; title?: string; snapshot?: string; screenshot?: string }
        action?: { action?: string; selector?: string; text?: string; result?: string }
      }>
    }
  }>
}

/** Pure mapper: bad's report.json → the neutral BrowserRun for taskId. The final
 *  turn's state.url is the observable final URL; its snapshot is the final DOM the
 *  deterministic dom-* checks read. */
export function badReportToRun(report: BadReport, taskId: string): BrowserRun {
  const res = report.results?.find((r) => r.testCase?.id === taskId) ?? report.results?.[0]
  const ar = res?.agentResult ?? {}
  const turns = Array.isArray(ar.turns) ? ar.turns : []
  const steps: BrowserStep[] = turns.map((t, i) => ({
    index: typeof t.turn === 'number' ? t.turn : i + 1,
    url: t.state?.url ?? '',
    action: t.action?.action ?? 'decide',
    target: t.action?.selector ?? (t.action?.text ? `"${t.action.text}"` : undefined),
    // The frame for the film: bad's per-turn base64 JPEG, normalized to a data: URI.
    screenshot: t.state?.screenshot ? `data:image/jpeg;base64,${t.state.screenshot}` : undefined,
  }))
  const last = turns[turns.length - 1]
  const input = typeof res?.inputTokens === 'number' ? res.inputTokens : undefined
  const output = typeof res?.outputTokens === 'number' ? res.outputTokens : undefined
  return {
    taskId,
    steps,
    finalUrl: last?.state?.url ?? '',
    finalDom: typeof last?.state?.snapshot === 'string' ? last.state.snapshot : undefined,
    answer: typeof ar.result === 'string' ? ar.result : undefined,
    selfReportedSuccess: typeof ar.success === 'boolean' ? ar.success : undefined,
    usage: input !== undefined || output !== undefined ? { input: input ?? 0, output: output ?? 0 } : undefined,
    costUsd: typeof res?.estimatedCostUsd === 'number' ? res.estimatedCostUsd : undefined,
    driverId: 'bad',
  }
}

function resolveCli(cfg: BadAdapterConfig): string {
  return cfg.badCli ?? process.env.BAD_CLI ?? join(process.env.HOME ?? '', 'code/browser-agent-driver/dist/cli.js')
}

/** A BrowserAgentAdapter backed by the `bad` CLI. Runs one task through a real
 *  browser; the harness judge attests the outcome. */
export function badBrowserAdapter(cfg: BadAdapterConfig = {}): BrowserAgentAdapter {
  const cli = resolveCli(cfg)
  const timeoutMs = cfg.timeoutMs ?? 300_000
  return {
    id: 'bad',
    async run(task: BrowserTask): Promise<BrowserRun> {
      const dir = await mkdtemp(join(tmpdir(), 'bad-adapter-'))
      const casesPath = join(dir, 'cases.json')
      const sink = join(dir, 'sink')
      const cases = [
        {
          id: task.id,
          name: task.id,
          goal: task.goal,
          url: task.startUrl,
          maxTurns: task.maxSteps ?? cfg.maxTurns ?? 20,
        },
      ]
      await writeFile(casesPath, JSON.stringify(cases))
      const args = [
        cli,
        'run',
        '--cases',
        casesPath,
        '--sink',
        sink,
        '--provider',
        cfg.provider ?? 'openai',
        '--model',
        cfg.model ?? 'deepseek-v4-flash',
        '--max-turns',
        String(task.maxSteps ?? cfg.maxTurns ?? 20),
        '--headless',
      ]
      // full-evidence + every-turn capture populates each turn's state.screenshot,
      // which badReportToRun lifts into BrowserStep.screenshot for the film.
      if (cfg.captureScreenshots) args.push('--mode', 'full-evidence', '--screenshot-interval', '1')
      if (cfg.baseUrl) args.push('--base-url', cfg.baseUrl)
      if (cfg.apiKey) args.push('--api-key', cfg.apiKey)
      if (task.storageState) args.push('--storage-state', task.storageState)
      try {
        await runChild('node', args, dir, timeoutMs)
        const report = JSON.parse(await readFile(join(sink, 'report.json'), 'utf8')) as BadReport
        return badReportToRun(report, task.id)
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}

function runChild(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`bad adapter timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`bad adapter failed to spawn: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`bad exited ${code}: ${err.slice(-300)}`))
      else resolve()
    })
  })
}
