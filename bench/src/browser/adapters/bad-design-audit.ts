/**
 * UiReviewerAdapter for browser-agent-driver's `bad design-audit --json` — the
 * reviewer that carries the DETERMINISTIC floor (axe a11y + WCAG contrast) the
 * panel verdict is derived from. One of N pluggable reviewers behind the neutral
 * UiReviewerAdapter contract; its subjective LLM findings are surfaced, its
 * MEASURED floor is what `judgeUiFloor` attests.
 *
 * `badDesignAuditToReviewRuns` is a pure, unit-testable mapper kept separate from
 * the spawn so the report-shape mapping is exercised without a browser/LLM.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DesignMeasurements,
  UiFinding,
  UiReviewRun,
  UiReviewTarget,
  UiReviewerAdapter,
} from '../ui-reviewer'

export interface BadDesignAuditConfig {
  /** Path to the bad CLI entry (default: $BAD_CLI or ~/code/browser-agent-driver/dist/cli.js). */
  badCli?: string
  /** Design-audit profile (saas/defi/…); forwarded as --profile when set. */
  profile?: string
  model?: string
  /** OpenAI-compatible endpoint — point at our router. */
  baseUrl?: string
  apiKey?: string
  /** Pages to crawl from the start URL (bad --pages). */
  pages?: number
  timeoutMs?: number
}

interface BadFinding {
  category?: string
  severity?: 'critical' | 'major' | 'minor'
  title?: string
  description?: string
  recommendation?: string
  selector?: string
}
interface BadMeasurements {
  contrast?: { aaFailures?: unknown[]; totalChecked?: number; summary?: { aaPassRate?: number } }
  a11y?: { violations?: Array<{ id?: string; impact?: string }> }
}
interface BadPage {
  route?: string
  url?: string
  findings?: BadFinding[]
  measurements?: BadMeasurements
  score?: number
  healthScore?: number
}
/** Wire shape of `bad design-audit --json` (the report.json the CLI writes). */
export interface BadDesignReport {
  pages?: BadPage[]
  summary?: { healthScore?: number; avgScore?: number }
}

/** Pure mapper: `bad design-audit --json` report → neutral UiReviewRun[] (one per
 *  page). The measured floor (axe + contrast) becomes DesignMeasurements; the LLM
 *  findings become UiFinding[]; healthScore is recorded as selfReportedScore only. */
export function badDesignAuditToReviewRuns(report: BadDesignReport): UiReviewRun[] {
  const pages = report.pages ?? []
  return pages.map((p, i) => {
    const route = p.route ?? p.url ?? `page-${i}`
    const findings: UiFinding[] = (p.findings ?? []).map((f) => ({
      reviewerId: 'bad-design-audit',
      lens: f.category ?? 'design',
      severity: f.severity ?? 'minor',
      route,
      title: f.title ?? '(finding)',
      observation: f.description ?? f.title ?? '',
      suggestedFix: f.recommendation,
      selector: f.selector,
    }))
    const m = p.measurements
    let measurements: DesignMeasurements | undefined
    if (m?.contrast || m?.a11y) {
      const failures = m.contrast?.aaFailures?.length ?? 0
      const total = m.contrast?.totalChecked ?? 0
      measurements = {
        a11yViolations: (m.a11y?.violations ?? []).map((v) => ({ id: v.id ?? 'unknown', impact: v.impact })),
        contrastAaPassRate: m.contrast?.summary?.aaPassRate ?? (total > 0 ? 1 - failures / total : 1),
        contrastAaFailures: failures,
        contrastTotalChecked: total,
      }
    }
    return {
      reviewerId: 'bad-design-audit',
      route,
      findings,
      measurements,
      selfReportedScore: p.healthScore ?? p.score,
    }
  })
}

function resolveCli(cfg: BadDesignAuditConfig): string {
  return cfg.badCli ?? process.env.BAD_CLI ?? join(process.env.HOME ?? '', 'code/browser-agent-driver/dist/cli.js')
}

/** A UiReviewerAdapter backed by `bad design-audit`. Drives a real browser audit
 *  (LLM findings + measured axe/contrast floor); the panel judge attests the floor. */
export function badDesignAuditReviewer(cfg: BadDesignAuditConfig = {}): UiReviewerAdapter {
  const cli = resolveCli(cfg)
  const timeoutMs = cfg.timeoutMs ?? 600_000
  return {
    id: 'bad-design-audit',
    async review(target: UiReviewTarget): Promise<UiReviewRun[]> {
      const dir = await mkdtemp(join(tmpdir(), 'bad-design-'))
      const args = [cli, 'design-audit', '--url', target.url, '--json', '--output', dir]
      if (cfg.profile) args.push('--profile', cfg.profile)
      if (cfg.pages) args.push('--pages', String(cfg.pages))
      if (cfg.model) args.push('--model', cfg.model)
      if (cfg.baseUrl) args.push('--base-url', cfg.baseUrl)
      if (cfg.apiKey) args.push('--api-key', cfg.apiKey)
      if (target.storageState) args.push('--storage-state', target.storageState)
      try {
        await runChild('node', args, dir, timeoutMs)
        const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as BadDesignReport
        return badDesignAuditToReviewRuns(report)
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
      reject(new Error(`bad design-audit timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`bad design-audit failed to spawn: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`bad design-audit exited ${code}: ${err.slice(-300)}`))
      else resolve()
    })
  })
}
