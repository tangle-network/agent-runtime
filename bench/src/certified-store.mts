/**
 * E3 certified-program memory (docs/research/e3-certified-memory.md): a jsonl store of
 * VERIFIER-CERTIFIED executable strategies — programs that won their gates, not
 * sentences about tasks. Admission is gated, not free; every row names its certificate:
 *
 *   promoted              — the certifying EvolutionReport's promotionGate verdict
 *                           PROMOTED the program (superiority or non-inferiority on a
 *                           fresh holdout slice). The strict rung; the default.
 *   displacer-reproducible — the program displaced the gen0 champion in search (a train
 *                           displacement, NOT a gate win) AND carries a REPRODUCIBLE
 *                           reproducer certificate (`reproduction.reproducible===true`:
 *                           a fresh author re-implemented it from the ~64-word summary
 *                           alone and matched it on the same holdout). The explicitly
 *                           weaker rung — opt-in via the CLI's `--seed-displacers`.
 *
 * Retrieval is by task-class match (the EOPS task family), fallback = the store's best
 * overall by certifying-holdout score. Retrieval is EXECUTION: the caller `load()`s
 * `row.file` and runs that Strategy at the arm's budget — program retrieval, not prompt
 * injection. `load()` re-applies `assertStrategyContract` (the author-blindness /
 * conserved-dose lint) before importing, so a hand-edited store file cannot smuggle
 * out-of-band capability into a measured arm.
 *
 * Row `file` paths are RELATIVE TO THE STORE FILE — the seed CLI copies each admitted
 * program into `<storeDir>/programs/` (bench/src/authored/ is gitignored; committed
 * memory must be self-contained) so a store directory is portable as one unit.
 *
 * Seed CLI (admission decisions printed per report — honest, never silent):
 *   tsx src/certified-store.mts seed --store runs/<date>/e3-certified-store/store.jsonl \
 *     --task-class eops:gym-itsm-mcp [--seed-displacers] runs/<date>/fw-*.json
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  assertStrategyContract,
  type EvolutionReport,
  type Strategy,
} from '@tangle-network/agent-runtime/loops'

export interface CertifiedRow {
  /** The strategy's name in the certifying run's report (the report/archive key). */
  name: string
  /** The task family the program was certified on (e.g. `eops:gym-itsm-mcp`). */
  taskClass: string
  /** Program module path, relative to the store file (or absolute). */
  file: string
  /** The ~64-word reproducer summary from the certifying run. */
  summary: string
  /** The certificate: `promoted:<gate reason>` or `displacer-reproducible:<detail>`. */
  verdictReason: string
  /** The program's score on the certifying run's HOLDOUT slice (generalization, not train). */
  score: number
  /** Mean usd per holdout task in the certifying run. */
  usd: number
  addedAt: string
}

export interface Retrieval {
  row: CertifiedRow
  /** 'class' = exact task-class match; 'fallback' = best overall by score (no class match). */
  match: 'class' | 'fallback'
}

const certifiedReasons = /^(promoted|displacer-reproducible):/

function validateRow(row: CertifiedRow): void {
  const filled = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  if (
    !filled(row.name) ||
    !filled(row.taskClass) ||
    !filled(row.file) ||
    !filled(row.verdictReason) ||
    !filled(row.addedAt) ||
    typeof row.summary !== 'string' ||
    typeof row.score !== 'number' ||
    typeof row.usd !== 'number'
  ) {
    throw new Error(`certified store: row "${row.name ?? '?'}" is missing required fields`)
  }
  if (!certifiedReasons.test(row.verdictReason)) {
    throw new Error(
      `certified store: row "${row.name}" rejected — verdictReason "${row.verdictReason}" names no certificate (must be promoted:* or displacer-reproducible:*); the gate certifies what the flywheel may remember`,
    )
  }
  if (row.score < 0 || row.score > 1) {
    throw new Error(`certified store: row "${row.name}" score ${row.score} outside [0,1]`)
  }
}

export class CertifiedStore {
  constructor(readonly path: string) {}

  /** Parse every row; an unreadable or malformed store THROWS (memory integrity over uptime). */
  rows(): CertifiedRow[] {
    if (!existsSync(this.path)) {
      throw new Error(`certified store: ${this.path} does not exist — seed it first (tsx src/certified-store.mts seed …)`)
    }
    const lines = readFileSync(this.path, 'utf8').split('\n').filter((l) => l.trim().length > 0)
    return lines.map((line, i) => {
      let row: CertifiedRow
      try {
        row = JSON.parse(line) as CertifiedRow
      } catch (e) {
        throw new Error(`certified store: ${this.path}:${i + 1} is not JSON — ${e instanceof Error ? e.message : e}`)
      }
      validateRow(row)
      return row
    })
  }

  /** The manual-row admission seam: validates the certificate vocabulary, then appends.
   *  A row that names no gate certificate is REJECTED — admission is gated, not free. */
  admit(row: CertifiedRow): void {
    validateRow(row)
    mkdirSync(dirname(this.path), { recursive: true })
    const prior = existsSync(this.path) ? readFileSync(this.path, 'utf8') : ''
    writeFileSync(this.path, `${prior}${JSON.stringify(row)}\n`)
  }

  /** Task-class match (best by certifying score), else best overall by score, else null
   *  (empty store — the caller records the miss). */
  retrieve(taskClass: string): Retrieval | null {
    const all = this.rows()
    if (all.length === 0) return null
    const byScore = (a: CertifiedRow, b: CertifiedRow) => b.score - a.score
    const classMatch = all.filter((r) => r.taskClass === taskClass).sort(byScore)[0]
    if (classMatch) return { row: classMatch, match: 'class' }
    const best = [...all].sort(byScore)[0]
    if (!best) return null
    return { row: best, match: 'fallback' }
  }

  /** Retrieval-is-execution: lint the program (assertStrategyContract), import it, return
   *  the Strategy. Throws on missing file, lint failure, or a module that is not a Strategy. */
  async load(row: CertifiedRow): Promise<Strategy> {
    const file = isAbsolute(row.file) ? row.file : resolve(dirname(this.path), row.file)
    const code = readFileSync(file, 'utf8')
    assertStrategyContract(code)
    const mod = (await import(`file://${file}`)) as { default?: Strategy }
    if (!mod.default || typeof mod.default.driver !== 'function' || !mod.default.name) {
      throw new Error(`certified store: ${file} does not export a default Strategy`)
    }
    return mod.default
  }
}

// ── Admission from an EvolutionReport ─────────────────────────────────────────────

export type AdmissionPolicy = 'promoted' | 'displacer-reproducible'

export interface AdmissionDecision {
  admitted: boolean
  policy: AdmissionPolicy
  /** Why (admitted or not) — printed by the CLI, recorded by callers. */
  reason: string
  /** Present when admitted: the row minus file/addedAt + the program's CURRENT path
   *  (the caller copies it next to the store and finalizes `file`). */
  candidate?: Omit<CertifiedRow, 'file' | 'addedAt'> & { sourceFile: string }
}

/** Apply the gate rule to a finished evolution run. Only the FINAL champion is ever a
 *  candidate (it is the only strategy the report's holdout gate measured), and only when
 *  it is an AUTHORED program with a module file. */
export function admitFromEvolution(
  report: EvolutionReport,
  opts: { taskClass: string; policy: AdmissionPolicy; summary?: string },
): AdmissionDecision {
  const { policy } = opts
  const champion = report.finalChampion
  const node = report.archive.find((n) => n.name === champion.name)
  if (!node || node.source !== 'authored' || !node.file) {
    return {
      admitted: false,
      policy,
      reason: `final champion "${champion.name}" is not an authored program (source=${node?.source ?? 'absent'}) — nothing to remember`,
    }
  }
  const holdoutCell = report.holdout.perStrategy[champion.name]
  if (!holdoutCell) {
    throw new Error(
      `admitFromEvolution: report's holdout carries no cell for champion "${champion.name}" — malformed report`,
    )
  }
  const summary = opts.summary ?? report.reproduction?.summary
  if (!summary) {
    return {
      admitted: false,
      policy,
      reason: `champion "${champion.name}" has no reproducer summary on the report and none was passed — rerun with reproducerCheck or pass --summary`,
    }
  }
  let verdictReason: string
  if (policy === 'promoted') {
    if (!report.verdict.promoted) {
      return {
        admitted: false,
        policy,
        reason: `gate verdict "${report.verdict.reason}" (promoted=false) for "${champion.name}" — strict admission refuses non-promoted programs`,
      }
    }
    verdictReason = `promoted:${report.verdict.reason}`
  } else {
    if (champion.name === report.gen0Champion.name) {
      return {
        admitted: false,
        policy,
        reason: `"${champion.name}" never displaced the gen0 champion — no train displacement to certify`,
      }
    }
    if (report.reproduction?.reproducible !== true) {
      return {
        admitted: false,
        policy,
        reason: `"${champion.name}" displaced on train but its reproducer certificate failed (reproducible=${report.reproduction?.reproducible ?? 'absent'}, gap=${report.reproduction ? (report.reproduction.gap * 100).toFixed(1) : '?'}pp) — an unreproducible win is an overfitting signal, not memory`,
      }
    }
    verdictReason = `displacer-reproducible:gate=${report.verdict.reason},repro-gap=${(report.reproduction.gap * 100).toFixed(1)}pp`
  }
  return {
    admitted: true,
    policy,
    reason: `"${champion.name}" admitted under ${policy} (${verdictReason}; holdout ${(holdoutCell.score * 100).toFixed(1)}%)`,
    candidate: {
      name: champion.name,
      taskClass: opts.taskClass,
      summary,
      verdictReason,
      score: holdoutCell.score,
      usd: holdoutCell.usd,
      sourceFile: node.file,
    },
  }
}

// ── Seed CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  store: string
  taskClass: string
  seedDisplacers: boolean
  reports: string[]
} {
  let store: string | undefined
  let taskClass: string | undefined
  let seedDisplacers = false
  const reports: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string
    if (a === '--store') store = argv[(i += 1)]
    else if (a === '--task-class') taskClass = argv[(i += 1)]
    else if (a === '--seed-displacers') seedDisplacers = true
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`)
    else reports.push(a)
  }
  if (!store) throw new Error('--store <path> is required')
  if (!taskClass) throw new Error('--task-class <class> is required (e.g. eops:gym-itsm-mcp) — the family the reports gated on')
  if (reports.length === 0) throw new Error('pass at least one EvolutionReport json')
  return { store, taskClass, seedDisplacers, reports }
}

async function seedMain(argv: string[]): Promise<void> {
  const { store: storePath, taskClass, seedDisplacers, reports } = parseArgs(argv)
  const store = new CertifiedStore(storePath)
  const existing = existsSync(storePath) ? store.rows() : []
  let admittedCount = 0
  for (const reportPath of reports) {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as EvolutionReport
    let decision = admitFromEvolution(report, { taskClass, policy: 'promoted' })
    if (!decision.admitted && seedDisplacers) {
      const strictReason = decision.reason
      decision = admitFromEvolution(report, { taskClass, policy: 'displacer-reproducible' })
      if (decision.admitted) decision.reason = `${decision.reason} [strict refused: ${strictReason}]`
    }
    console.error(`${decision.admitted ? 'ADMIT' : 'skip '}  ${basename(reportPath)}: ${decision.reason}`)
    if (!decision.admitted || !decision.candidate) continue
    const c = decision.candidate
    if (existing.some((r) => r.name === c.name && r.taskClass === c.taskClass)) {
      console.error(`       (already in store as ${c.name}@${c.taskClass} — skipped)`)
      continue
    }
    // Self-contained memory: copy the program beside the store (authored/ is gitignored).
    const programsDir = join(dirname(storePath), 'programs')
    mkdirSync(programsDir, { recursive: true })
    const programFile = `${c.name}-${basename(c.sourceFile)}`
    copyFileSync(c.sourceFile, join(programsDir, programFile))
    const row: CertifiedRow = {
      name: c.name,
      taskClass: c.taskClass,
      file: join('programs', programFile),
      summary: c.summary,
      verdictReason: c.verdictReason,
      score: c.score,
      usd: c.usd,
      addedAt: new Date().toISOString(),
    }
    await store.load(row) // prove the copied program lints + imports before persisting it
    store.admit(row)
    existing.push(row)
    admittedCount += 1
  }
  console.error(`\nstore ${storePath}: ${existing.length} row(s) total (${admittedCount} added this seeding)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd !== 'seed') {
    console.error('usage: tsx src/certified-store.mts seed --store <store.jsonl> --task-class <class> [--seed-displacers] <report.json…>')
    process.exit(2)
  }
  seedMain(rest).catch((e) => {
    console.error(`certified-store: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
    process.exit(1)
  })
}
