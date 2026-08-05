/**
 *
 * `rawTraceDistiller` — the meta-harness `analyzeGeneration` producer.
 *
 * The default `generationFailureDistiller` (in `improve.ts`) COMPRESSES each
 * generation's failing cells into ~1500-char structured findings before the next
 * proposal round. That is the ACE-style recipe: a small summary is the proposer's
 * whole view of what went wrong. This producer does the opposite — the
 * meta-harness recipe (yoonholee.com/meta-harness): it does NOT summarize. It
 * points the coding-agent proposer at the generation's RAW run traces already on
 * disk under `runDir` — the durable per-cell `spans.jsonl` event logs,
 * `cached-result.json` scores, and any artifacts the substrate persisted — and
 * instructs the agent to `grep`/`cat`/`ls` them to diagnose the failures itself
 * (up to the harness's full context, ~millions of tokens, vs a ~1500-char digest).
 *
 * It emits `ProposalFinding[]` so it drops into the same `opts.analyzeGeneration`
 * slot the default distiller uses, and renders through the same
 * `agenticGenerator` prompt path (`claim` + `recommended_action`). The findings
 * carry ABSOLUTE paths — the coding harness runs with `cwd` = a candidate
 * worktree, so a relative `runDir` would be uncattable from there.
 *
 * Runtime layout it reads (written by agent-eval's optimization loop):
 *
 *   <runDir>/gen-<N>/                     ← the generation dir (input.runDir)
 *     candidate-<i>/                      ← one candidate campaign (campaign.runDir)
 *       <sanitized cellId>/               ← one scenario×rep cell
 *         spans.jsonl                     ← the raw trace (event/span log)
 *         cached-result.json              ← the cell's score + artifact ref
 *         <artifacts…>                    ← whatever the dispatch wrote
 *
 * @stable
 */

import { type Dirent, existsSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { makeProposalFinding, type ProposalFinding } from '@tangle-network/agent-eval'
import type { Scenario, SelfImproveOptions } from '@tangle-network/agent-eval/contract'

const ANALYST_ID = 'raw-trace-distiller'
/** A cell counts as "failing" below this mean composite (matches the default
 *  distiller's near-perfect threshold) or when it recorded an `error`. */
const PASS_THRESHOLD = 0.999

export interface RawTraceDistillerOptions {
  /** Anchor the emitted paths at this run root instead of the generation `runDir`
   *  the loop passes in. Normally unset — each call points at that generation's
   *  own directory (`input.runDir`). Pass an absolute path when you construct the
   *  producer ahead of the loop and want a fixed anchor (e.g. a test fixture). */
  runDir?: string
  /** Max candidates to surface trace paths for, worst-scoring first. Default 12. */
  maxCandidates?: number
  /** Max failing cells to enumerate per candidate before collapsing the rest into
   *  an "ls the candidate dir" pointer. Default 8. */
  maxCellsPerCandidate?: number
  /** Max concrete file paths to list per cell (the agent can always `ls` the dir
   *  for the rest). Default 24. */
  maxFilesPerCell?: number
  /** Findings to fall back to when the generation had NO failing cells, so a
   *  clean round never wipes the proposer's steering context. Mirrors the default
   *  distiller's static-seed fallback. Default: a single instruction finding. */
  fallbackFindings?: ReadonlyArray<ProposalFinding>
}

interface CellTrace {
  scenarioId: string
  composite: number
  error?: string
  cellDir: string
  files: string[]
  truncatedFiles: boolean
}

/**
 * Build an `analyzeGeneration` producer that feeds the proposer RAW-TRACE
 * FILESYSTEM CONTEXT — paths into the prior generation's real run traces plus a
 * grep/cat-to-diagnose instruction — instead of a pre-summarized digest.
 *
 * Drop-in for `analyzeGeneration` on `improve({ surface: 'code' })`:
 *
 *   await improve({
 *     surface: 'code',
 *     findings: seedFindings,
 *     code: { repoRoot, profile, executorForWorktree, buildPrompt },
 *     runDir: '/abs/run',                 // MUST be a real path — the traces live here
 *     analyzeGeneration: rawTraceDistiller(),
 *     scenarios, judge, agent,
 *   })
 */
export function rawTraceDistiller<TScenario extends Scenario = Scenario, TArtifact = unknown>(
  options: RawTraceDistillerOptions = {},
): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']> {
  const maxCandidates = options.maxCandidates ?? 12
  const maxCellsPerCandidate = options.maxCellsPerCandidate ?? 8
  const maxFilesPerCell = options.maxFilesPerCell ?? 24

  return async (input) => {
    const genRoot = absoluteRunDir(options.runDir ?? input.runDir)
    const durable = isDurable(genRoot)

    // Rank candidates worst-first; the worst failures are the highest-signal
    // context for the next edit. Stable sort keeps equal-composite order.
    const ranked = [...input.candidates]
      .map((c) => ({
        surfaceHash: c.surfaceHash,
        composite: c.composite,
        campaignDir: absoluteRunDir(c.campaign.runDir),
        cells: failingCells(c.campaign, maxCellsPerCandidate, maxFilesPerCell),
      }))
      .sort((a, b) => compareCandidateComposites(a.composite, b.composite))
      .slice(0, maxCandidates)

    const totalFailingCells = ranked.reduce((n, c) => n + c.cells.length, 0)

    // A clean generation: keep the proposer's steering context rather than
    // wiping it (parity with the default distiller's static-seed fallback). An
    // EMPTY fallback array means there is no STATIC seed to preserve — it must NOT
    // wipe the context to nothing. Fall through to the default raw-trace
    // instruction so the meta-harness discipline stays live (the agent still
    // inspects the on-disk traces next round, and the finding's `raw-trace-context`
    // area keeps the agenticGenerator's diagnosis-evidence gate armed). A bare
    // `??` would return the empty array and silently disable both.
    if (totalFailingCells === 0) {
      if (options.fallbackFindings && options.fallbackFindings.length > 0) {
        return options.fallbackFindings
      }
      return [
        makeProposalFinding({
          analyst_id: ANALYST_ID,
          proposal_origin: 'search',
          severity: 'info',
          area: 'raw-trace-context',
          confidence: 1,
          claim: `Generation ${input.generation} had no failing cells. The full raw run traces are on disk under ${genRoot}.`,
          recommended_action: `To keep improving, grep/cat the raw traces under ${genRoot} (per-cell spans.jsonl + cached-result.json) to find the weakest passing runs, then make a targeted harness-code edit.`,
          evidence_refs: [{ kind: 'artifact', uri: genRoot }],
          metadata: { generation: input.generation, runDir: genRoot, failingCells: 0 },
        }),
      ]
    }

    const findings: ProposalFinding[] = []

    // 1. The meta-harness instruction: diagnose from the RAW traces, not a digest.
    findings.push(
      makeProposalFinding({
        analyst_id: ANALYST_ID,
        proposal_origin: 'search',
        severity: 'high',
        area: 'raw-trace-context',
        confidence: 1,
        claim: `Generation ${input.generation} produced ${totalFailingCells} failing/low-scoring cell(s) across ${ranked.length} candidate(s). Their FULL RAW run traces are on disk under ${genRoot} — the actual event logs (spans.jsonl), scores (cached-result.json), and artifacts, not a summary.${
          durable
            ? ''
            : ' (WARNING: this run root does not exist on disk — it looks like an in-memory run; pass a real runDir to improve() to get raw-trace context.)'
        }`,
        recommended_action: `Do NOT rely on a pre-summarized finding. Before editing, DIAGNOSE from the raw traces: run \`grep\`/\`cat\`/\`ls\` over the trace files and directories named in the following findings to see exactly what each failing run did and why it scored low, then make the smallest harness-code edit that fixes the dominant failure. Start with \`grep -rIn "error" ${genRoot}\` then \`cat\` the spans.jsonl of the worst cell.`,
        evidence_refs: [{ kind: 'artifact', uri: genRoot }],
        metadata: {
          generation: input.generation,
          runDir: genRoot,
          failingCells: totalFailingCells,
          candidates: ranked.length,
        },
      }),
    )

    // 2. One finding per failing candidate: its campaign dir + the concrete raw
    //    trace files to grep/cat.
    for (const cand of ranked) {
      if (cand.cells.length === 0) continue
      const scenarioList = cand.cells.map((c) => c.scenarioId).join(', ')
      const fileLines = cand.cells
        .map((c) => {
          const header = `  cell ${c.scenarioId} (composite ${c.composite.toFixed(3)}${
            c.error ? `, error: ${truncate(c.error, 160)}` : ''
          }) — dir ${c.cellDir}`
          const files = c.files.map((f) => `    - ${f}`).join('\n')
          const more = c.truncatedFiles ? `\n    - …(ls ${c.cellDir} for the rest)` : ''
          return c.files.length > 0 ? `${header}\n${files}${more}` : header
        })
        .join('\n')

      findings.push(
        makeProposalFinding({
          analyst_id: ANALYST_ID,
          proposal_origin: 'search',
          severity: cand.composite !== null && cand.composite < 0.5 ? 'critical' : 'high',
          area: 'raw-trace-context',
          confidence: 1,
          subject: cand.surfaceHash,
          claim: `Candidate ${cand.surfaceHash} ${candidateCompositeDescription(cand.composite)} with ${cand.cells.length} failing cell(s) [${scenarioList}]. Its raw traces are under ${cand.campaignDir}.`,
          recommended_action: `grep/cat these raw trace files to diagnose WHY this candidate failed before editing:\n${fileLines}\nOr scan the whole candidate at once: \`grep -rIn . ${cand.campaignDir}\` and \`ls -R ${cand.campaignDir}\`.`,
          evidence_refs: [
            { kind: 'artifact', uri: cand.campaignDir },
            ...cand.cells.flatMap((c) =>
              c.files.map((f) => ({ kind: 'artifact' as const, uri: f })),
            ),
          ],
          metadata: {
            surfaceHash: cand.surfaceHash,
            composite: cand.composite,
            campaignDir: cand.campaignDir,
            cells: cand.cells.map((c) => ({
              scenarioId: c.scenarioId,
              composite: c.composite,
              cellDir: c.cellDir,
              files: c.files,
              ...(c.error ? { error: c.error } : {}),
            })),
          },
        }),
      )
    }

    return findings
  }
}

/** Keep unscored candidates visible without inventing a numeric aggregate. */
function compareCandidateComposites(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return left - right
}

function candidateCompositeDescription(composite: number | null): string {
  return composite === null ? 'has no aggregate score' : `scored composite ${composite.toFixed(3)}`
}

/** The failing cells of a candidate campaign, each with its on-disk trace files.
 *  Mirrors the default distiller's per-cell composite (mean of judge composites,
 *  0 when a cell produced no judge score) and its failing predicate. */
function failingCells(
  campaign: {
    runDir: string
    cells: ReadonlyArray<{
      cellId: string
      scenarioId: string
      error?: string
      judgeScores: Record<string, { composite?: number }>
    }>
    artifactsByPath?: Record<string, string>
  },
  maxCells: number,
  maxFiles: number,
): CellTrace[] {
  const campaignDir = absoluteRunDir(campaign.runDir)
  const durable = isDurable(campaignDir)
  const out: CellTrace[] = []
  for (const cell of campaign.cells) {
    const scores = Object.values(cell.judgeScores ?? {})
    const composite =
      scores.length === 0
        ? 0
        : scores.reduce((sum, s) => sum + (s.composite ?? 0), 0) / scores.length
    if (!cell.error && composite >= PASS_THRESHOLD) continue

    const cellDir = join(campaignDir, sanitizeCellId(cell.cellId))
    const artifactPaths = artifactPathsForCell(campaign.artifactsByPath, cell.cellId)
    const discovered = durable ? listTraceFiles(cellDir) : []
    // Canonical anchors the substrate always writes, kept even when a mem:// run
    // never flushed them to disk (so the agent still learns the expected path).
    const canonical = [join(cellDir, 'spans.jsonl'), join(cellDir, 'cached-result.json')]
    const files = dedupeSorted([...discovered, ...artifactPaths, ...canonical])

    out.push({
      scenarioId: cell.scenarioId,
      composite: Number(composite.toFixed(3)),
      ...(cell.error ? { error: cell.error } : {}),
      cellDir,
      files: files.slice(0, maxFiles),
      truncatedFiles: files.length > maxFiles,
    })
    if (out.length >= maxCells) break
  }
  return out
}

/** Absolute paths of artifacts the campaign recorded for a cell. `artifactsByPath`
 *  is keyed `${cellId}/${relPath}` → absolute path. */
function artifactPathsForCell(
  artifactsByPath: Record<string, string> | undefined,
  cellId: string,
): string[] {
  if (!artifactsByPath) return []
  const prefix = `${cellId}/`
  return Object.entries(artifactsByPath)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, absPath]) => resolve(absPath))
}

/** Real files directly under `dir` and one level of sub-directories (artifacts
 *  are sometimes nested). Absolute paths, sorted. `[]` when the dir is absent,
 *  stale, unreadable, or contains symlinked dirs — trace context is advisory and
 *  the canonical anchors below still tell the proposer where to inspect. */
function listTraceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of safeReadDir(dir)) {
    const full = join(dir, entry.name)
    if (entry.isFile()) {
      out.push(full)
    } else if (!entry.isSymbolicLink() && entry.isDirectory()) {
      for (const sub of safeReadDir(full)) {
        if (sub.isFile()) out.push(join(full, sub.name))
      }
    }
  }
  return out
}

function safeReadDir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Substrate cell-dir sanitization — must match agent-eval's
 *  `cellId.replace(/[^a-zA-Z0-9_-]/g, '_')` so the computed dir matches disk. */
function sanitizeCellId(cellId: string): string {
  return cellId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** A run root is durable (has real files) when it is not an in-memory sentinel
 *  and exists on disk. `mem://` runs keep everything in-process — no traces. */
function isDurable(runDir: string): boolean {
  return !runDir.startsWith('mem://') && existsSync(runDir)
}

/** Resolve a run dir to absolute (the coding harness runs from a worktree cwd, so
 *  relative paths are uncattable there). `mem://` sentinels pass through untouched. */
function absoluteRunDir(runDir: string): string {
  return runDir.startsWith('mem://') ? runDir : resolve(runDir)
}

function dedupeSorted(paths: string[]): string[] {
  return [...new Set(paths)].sort((a, b) => {
    // Group by directory then filename for a stable, readable listing.
    const da = a.slice(0, a.length - basename(a).length)
    const db = b.slice(0, b.length - basename(b).length)
    return da === db ? basename(a).localeCompare(basename(b)) : da.localeCompare(db)
  })
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}
