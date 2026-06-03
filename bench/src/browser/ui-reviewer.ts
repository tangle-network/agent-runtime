/**
 * Driver-agnostic UI-REVIEWER PANEL — the design-review analogue of the
 * browser-agent harness (./agent-adapter.ts).
 *
 * "More reviewers, the better": run a PANEL of UI reviewers over the same target
 * and union their findings — #114's runLoop ui-auditor, browser-agent-driver's
 * `bad design-audit`, a future reviewer — each a pluggable `UiReviewerAdapter`,
 * none of them owning the verdict.
 *
 * Attestability is the spine, exactly as in agent-adapter.ts: a UI design verdict
 * is SUBJECTIVE if it comes from an LLM/heuristic, so the panel NEVER lets a
 * reviewer's own findings or headline score (e.g. a `healthScore`) be the verdict.
 * The attestable verdict is derived ONLY from the DETERMINISTIC floor a reviewer
 * MEASURES — axe a11y violations + WCAG AA contrast — re-applied by `judgeUiFloor`.
 * Subjective findings are surfaced (deduped, attributed) but never gate.
 *
 * A reviewer that contributes no deterministic measurements adds findings to the
 * panel but cannot, by itself, produce an attestable verdict — that is fail-loud,
 * not a silent pass.
 */

/** What to review: a site + the routes to visit. */
export interface UiReviewTarget {
  url: string
  /** Route labels/paths to audit; defaults to a single 'home' at `url`. */
  routes?: { label: string; url: string }[]
  viewport?: { width: number; height: number }
  /** Playwright storageState for authenticated review. */
  storageState?: string
}

/** A SUBJECTIVE finding (LLM/heuristic). Surfaced + deduped, never the verdict. */
export interface UiFinding {
  reviewerId: string
  /** Lens/category (consistency, hierarchy, accessibility, contrast, ux-flow, …). */
  lens: string
  severity: 'critical' | 'major' | 'minor'
  route: string
  title: string
  observation: string
  impact?: string
  suggestedFix?: string
  /** CSS/Playwright selector, when the reviewer pins one — used for dedup. */
  selector?: string
}

/** The DETERMINISTIC floor — MEASURED, not judged. This is the attestable layer
 *  (mirrors browser-agent-driver's `measurements`: axe + WCAG contrast). */
export interface DesignMeasurements {
  /** axe a11y violations with rule id + impact. */
  a11yViolations: { id: string; impact?: string }[]
  /** WCAG AA contrast pass rate in [0,1] over `contrastTotalChecked` text elements. */
  contrastAaPassRate: number
  contrastAaFailures: number
  contrastTotalChecked: number
}

/** One reviewer's result for one route. */
export interface UiReviewRun {
  reviewerId: string
  route: string
  findings: UiFinding[]
  /** Present only if the reviewer measured the deterministic floor. */
  measurements?: DesignMeasurements
  /** The reviewer's OWN headline score (e.g. healthScore 0-100). Recorded for
   *  comparison, NEVER the verdict. */
  selfReportedScore?: number
  usage?: { input: number; output: number }
  costUsd?: number
}

/** The general seam every UI reviewer implements — `bad design-audit`, the #114
 *  ui-auditor, a hosted service. `review` returns one run per route. */
export interface UiReviewerAdapter {
  readonly id: string
  review(target: UiReviewTarget): Promise<UiReviewRun[]>
}

/** Thresholds for the deterministic blocking gate (defaults mirror the
 *  browser-agent-driver design-audit floor: 5+ critical a11y OR >25% contrast fail). */
export interface UiFloorGateConfig {
  maxCriticalA11y?: number
  maxContrastFailRate?: number
}

const A11Y_CRITICAL = new Set(['critical', 'serious'])

/**
 * The ATTESTABLE verdict — derived ONLY from the deterministic floor across the
 * runs that measured it. Ignores subjective findings AND selfReportedScore.
 * resolved = no blocking deterministic issues; score = deterministic design-health
 * in [0,1] (contrast pass rate × a11y cleanliness). Fail-loud if NO run measured
 * the floor — a panel of purely-subjective reviewers cannot attest a verdict.
 */
export function judgeUiFloor(
  runs: ReadonlyArray<UiReviewRun>,
  cfg: UiFloorGateConfig = {},
): { resolved: boolean; score: number; detail: string } {
  const maxCriticalA11y = cfg.maxCriticalA11y ?? 5
  const maxContrastFailRate = cfg.maxContrastFailRate ?? 0.25
  const measured = runs.filter((r) => r.measurements)
  if (measured.length === 0) {
    throw new Error(
      'judgeUiFloor: no reviewer produced deterministic measurements (axe/contrast) — ' +
        'subjective findings are not attestable; add a reviewer with a measured floor',
    )
  }
  let criticalA11y = 0
  let worstContrastFailRate = 0
  let passRateSum = 0
  for (const r of measured) {
    const m = r.measurements as DesignMeasurements
    criticalA11y += m.a11yViolations.filter((v) => v.impact != null && A11Y_CRITICAL.has(v.impact)).length
    const failRate = 1 - m.contrastAaPassRate
    if (failRate > worstContrastFailRate) worstContrastFailRate = failRate
    passRateSum += m.contrastAaPassRate
  }
  const blocking = criticalA11y >= maxCriticalA11y || worstContrastFailRate > maxContrastFailRate
  const avgContrastPass = passRateSum / measured.length
  // a11y cleanliness: 1 when no critical issues, decaying toward 0 as they approach the cap.
  const a11yHealth = Math.max(0, 1 - criticalA11y / maxCriticalA11y)
  const score = Number((0.6 * avgContrastPass + 0.4 * a11yHealth).toFixed(4))
  return {
    resolved: !blocking,
    score,
    detail: JSON.stringify({
      criticalA11y,
      worstContrastFailRate: Number(worstContrastFailRate.toFixed(4)),
      avgContrastPass: Number(avgContrastPass.toFixed(4)),
      measuredReviewers: measured.map((r) => r.reviewerId),
      blocking,
    }),
  }
}

/** Dedup key for a finding across reviewers: same lens + route + (selector or a
 *  normalized title) is one issue, regardless of how many reviewers flagged it. */
function findingKey(f: UiFinding): string {
  const anchor = f.selector?.trim() || f.title.toLowerCase().replace(/\s+/g, ' ').trim()
  return `${f.lens.toLowerCase()}|${f.route}|${anchor}`
}

export interface UiPanelFinding extends UiFinding {
  /** All reviewers that independently flagged this issue (consensus signal). */
  flaggedBy: string[]
}

export interface UiPanelResult {
  perReviewer: Record<string, UiReviewRun[]>
  /** Deduped union of findings across reviewers, each tagged with who flagged it. */
  findings: UiPanelFinding[]
  /** The attestable deterministic-floor verdict (NOT a vote over findings). */
  verdict: { resolved: boolean; score: number; detail: string }
}

/**
 * Run a PANEL of reviewers over one target, union+dedup their subjective findings
 * (attributed, with a consensus count), and attest the deterministic floor. A
 * reviewer that throws is recorded as empty (its absence is visible in
 * perReviewer), never silently merged as a pass.
 */
export async function runUiReviewerPanel(
  target: UiReviewTarget,
  reviewers: ReadonlyArray<UiReviewerAdapter>,
  cfg: UiFloorGateConfig = {},
): Promise<UiPanelResult> {
  if (reviewers.length === 0) throw new Error('runUiReviewerPanel: no reviewers given')
  const settled = await Promise.all(
    reviewers.map(async (rev) => {
      try {
        return { id: rev.id, runs: await rev.review(target) }
      } catch (err) {
        return { id: rev.id, runs: [] as UiReviewRun[], error: err instanceof Error ? err.message : String(err) }
      }
    }),
  )
  const perReviewer: Record<string, UiReviewRun[]> = {}
  const allRuns: UiReviewRun[] = []
  for (const s of settled) {
    perReviewer[s.id] = s.runs
    allRuns.push(...s.runs)
  }
  const byKey = new Map<string, UiPanelFinding>()
  for (const run of allRuns) {
    for (const f of run.findings) {
      const key = findingKey(f)
      const existing = byKey.get(key)
      if (existing) {
        if (!existing.flaggedBy.includes(f.reviewerId)) existing.flaggedBy.push(f.reviewerId)
      } else {
        byKey.set(key, { ...f, flaggedBy: [f.reviewerId] })
      }
    }
  }
  return {
    perReviewer,
    findings: [...byKey.values()],
    verdict: judgeUiFloor(allRuns, cfg),
  }
}
