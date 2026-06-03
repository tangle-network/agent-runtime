/**
 * Driver-agnostic browser-agent harness — the GENERAL seam.
 *
 * The benchmark owns the task and the verdict; the browser AGENT is pluggable.
 * Any driver — @tangle-network/browser-agent-driver, browser-use (Python),
 * a hosted API, a future tool — conforms to ONE neutral contract: given a goal +
 * start URL, produce a normalized trajectory and a final observable state. We do
 * NOT shape this around any one driver's SDK; it is the least-common-denominator
 * a browser agent can emit, crossed with what a deterministic judge needs.
 *
 * Attestability is the whole point. We NEVER trust the driver's own `success`
 * flag or its LLM goal-verification (that is the unverifiable self-report the
 * benchmark exists to replace). Our judge re-derives the outcome from DETERMINISTIC
 * criteria (url / DOM state / element checks) against the run's final state. A
 * driver's published number is a hypothesis our harness attests or refutes.
 *
 * Language-agnostic by a process boundary: a driver that isn't TypeScript (e.g.
 * browser-use) is wrapped by `processBrowserAdapter`, which hands the task as JSON
 * on argv/stdin and reads a BrowserRun back as JSON on stdout. No SDK coupling, no
 * overfit — adding a driver is a thin runner that speaks this JSON, nothing more.
 */

/** A deterministic, driver-independent success check the JUDGE applies to the
 *  run's final state — never the agent's self-assessment. Mirrors the kinds a
 *  benchmark harness actually ships (WebArena program-state, Mind2Web element). */
export type SuccessSpec =
  | { type: 'url-contains'; value: string }
  | { type: 'url-matches'; value: string } // regex on finalUrl
  | { type: 'final-answer-matches'; value: string } // regex on the agent's answer (extraction tasks)
  | { type: 'dom-contains'; value: string } // substring of the final DOM/text snapshot
  | { type: 'dom-selector-text'; selector: string; value: string } // element text equals/contains
  | { type: 'program'; id: string } // a benchmark-provided programmatic check keyed by id

/** A task handed to ANY browser agent. `success` is the benchmark's deterministic
 *  verdict spec — evaluated by us, not the driver. */
export interface BrowserTask {
  id: string
  goal: string
  startUrl: string
  maxSteps?: number
  /** Path to a Playwright storageState for authenticated tasks (optional). */
  storageState?: string
  /** Deterministic success criteria the judge applies to the produced run. */
  success: SuccessSpec[]
  /** Benchmark-specific extras the judge may need (gold answer, program inputs). */
  metadata?: Record<string, unknown>
}

/** One normalized step, common to every driver. */
export interface BrowserStep {
  index: number
  /** URL at this step. */
  url: string
  /** A normalized action label (e.g. 'click', 'type', 'navigate', 'scroll'). */
  action: string
  /** Human/agent-readable target or value (selector, text typed, link). */
  target?: string
  /** Agent's reasoning for this step, if the driver exposes it. */
  reasoning?: string
  /** Path to a per-step screenshot on disk (for the run-capsule film). */
  screenshotPath?: string
  /** Target element box at action time, if known — for replay cursor overlays. */
  actionBounds?: { x: number; y: number; width: number; height: number }
}

/** The normalized result ANY driver produces — the judge scores this, not the
 *  driver's opinion of itself. */
export interface BrowserRun {
  taskId: string
  steps: BrowserStep[]
  /** URL the agent ended on. */
  finalUrl: string
  /** Final visible text / DOM snapshot for dom-* deterministic checks. */
  finalDom?: string
  /** The agent's final free-text answer (extraction tasks). */
  answer?: string
  /** The driver's OWN success claim — recorded for comparison, NEVER the verdict. */
  selfReportedSuccess?: boolean
  /** Real token usage + cost if the driver reports it (backend-integrity). */
  usage?: { input: number; output: number }
  costUsd?: number
  /** Which driver produced this run (for compareDrivers attribution). */
  driverId: string
}

/** The general seam every browser driver implements (directly in TS, or via the
 *  process wrapper below). `id` is the attribution key for head-to-head. */
export interface BrowserAgentAdapter {
  readonly id: string
  run(task: BrowserTask): Promise<BrowserRun>
}

/** Optional per-benchmark programmatic checks, keyed by SuccessSpec {type:'program', id}. */
export type ProgramChecks = Record<string, (run: BrowserRun, task: BrowserTask) => boolean>

/** The DETERMINISTIC, attestable verdict: evaluate the benchmark's SuccessSpec list
 *  against the run's final observable state. Independent of selfReportedSuccess.
 *  resolved = ALL criteria pass; score = fraction passed (a gradient for the optimizer). */
export function judgeBrowserRun(
  task: BrowserTask,
  run: BrowserRun,
  programs: ProgramChecks = {},
): { resolved: boolean; score: number; detail: string } {
  const checks = task.success
  if (checks.length === 0) throw new Error(`browser task ${task.id} has no success criteria — cannot attest`)
  const results = checks.map((c) => ({ c, ok: evalCriterion(c, run, task, programs) }))
  const passed = results.filter((r) => r.ok).length
  const resolved = passed === checks.length
  return {
    resolved,
    score: passed / checks.length,
    detail: JSON.stringify({
      passed,
      total: checks.length,
      selfReported: run.selfReportedSuccess,
      finalUrl: run.finalUrl,
      perCriterion: results.map((r) => ({ type: r.c.type, ok: r.ok })),
    }),
  }
}

function evalCriterion(c: SuccessSpec, run: BrowserRun, task: BrowserTask, programs: ProgramChecks): boolean {
  switch (c.type) {
    case 'url-contains':
      return run.finalUrl.includes(c.value)
    case 'url-matches':
      return new RegExp(c.value).test(run.finalUrl)
    case 'final-answer-matches':
      return run.answer != null && new RegExp(c.value, 'i').test(run.answer)
    case 'dom-contains':
      return run.finalDom != null && run.finalDom.includes(c.value)
    case 'dom-selector-text':
      // Deterministic only with a structured snapshot; require finalDom to carry it.
      return run.finalDom != null && run.finalDom.includes(c.value)
    case 'program': {
      const fn = programs[c.id]
      if (!fn) throw new Error(`browser task ${task.id}: no program check registered for id '${c.id}'`)
      return fn(run, task)
    }
  }
}
