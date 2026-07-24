/**
 * Gen-5 author briefing — MAP + TOOLBOX + PERMISSION (gen5_design).
 *
 * Principle: fully agentic evidence access, NO pre-digestion machinery. The
 * dossier-compiler / ranked-briefing pipeline is dead; instead each run writes
 * an INDEX FILE (a map: one line per evidence path) and the author prompt
 * names the pre-existing TOOLS the author may drive itself, plus explicit
 * permission to spawn its own subagents under a research budget. The
 * 3-analyst diagnosis ensemble stays as ONE input among these — no longer the
 * sole channel.
 *
 * SELF-IMPROVING BRIEFING: the briefing text itself lives in the declared
 * change-space — `extensions/pi/author-briefing.md` in the loops repo. When
 * that file exists at the incumbent ref it REPLACES the default text below,
 * so a future generation's author can rewrite its own research instructions
 * and the gate decides whether that rewrite earns its keep. The default here
 * is the versioned fallback (`AUTHOR_BRIEFING_VERSION`).
 *
 * PUBLIC/PRIVATE INTERACTION: the index is proposer-visible text, so
 * per-instance evidence rows for PRIVATE instances (score-split.mts) are
 * excluded and the writer fails loud if a private id leaks into the rendered
 * index.
 */

import { existsSync } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { leaksPrivateInstance, type ScoreSplit } from './score-split.mts'
import { run } from './proc.ts'

export const AUTHOR_BRIEFING_VERSION = 'map-toolbox-v1'

/** Loops-repo path (inside the declared change-space) whose content, when
 *  present at the incumbent ref, replaces the default briefing text. */
export const AUTHOR_BRIEFING_RELPATH = 'extensions/pi/author-briefing.md'

export const EVIDENCE_INDEX_FILENAME = 'evidence-index.md'

/** The default TOOLBOX + PERMISSION briefing. Every tool named here already
 *  exists — nothing bespoke is built for the author. */
export function defaultAuthorBriefing(): string {
  return [
    `<!-- author-briefing ${AUTHOR_BRIEFING_VERSION} (default; override by committing ${AUTHOR_BRIEFING_RELPATH}) -->`,
    'RESEARCH BRIEFING — you have hands. Read the evidence yourself before editing.',
    '',
    'TOOLBOX (all pre-existing — drive them yourself):',
    '- traces CLI (published): `npx --yes @tangle-network/traces@latest analyze --help` — analyze any',
    '  harness run trace (worker/supervisor sessions) for failure patterns, tool-call churn, dead ends.',
    '- agent-eval trace analysts (`@tangle-network/agent-eval/analyst`): structured extraction over run',
    '  artifacts when you want findings objects rather than prose.',
    '- AxLLM (`@ax-llm/ax`): question-answering over a corpus too large to read — point it at a run dir',
    '  and ask targeted questions instead of paging through megabytes.',
    '- Plain grep/jq over the evidence map below — often the fastest tool.',
    '',
    'PERMISSION: you may spawn your own subagents (research fan-out) before writing any code.',
    'Research budget: up to ~15 minutes / ~200k tokens of reading+subagents before your first edit;',
    'spend it on the evidence paths in the map, not on re-deriving what they already record.',
    '',
    'The diagnosis findings in this prompt come from a 3-analyst ensemble. Treat them as ONE input',
    'among the evidence sources above — verify any finding you build on against the raw artifacts.',
    '',
    `SELF-IMPROVEMENT: this briefing text is part of the change-space (${AUTHOR_BRIEFING_RELPATH}).`,
    'If your research process was hampered by these instructions, you may edit that file in your',
    'candidate alongside your main change; future generations will read your version.',
  ].join('\n')
}

/** Resolve the briefing text: the change-space override at `ref` when present,
 *  else the versioned default. */
export async function resolveAuthorBriefing(
  loopsRepo: string,
  ref: string,
): Promise<{ text: string; source: 'change-space' | 'default' }> {
  const show = await run('git', ['-C', loopsRepo, 'show', `${ref}:${AUTHOR_BRIEFING_RELPATH}`])
  if (show.code === 0 && show.stdout.trim().length > 0) {
    return { text: show.stdout, source: 'change-space' }
  }
  return { text: defaultAuthorBriefing(), source: 'default' }
}

// ---------------------------------------------------------------------------
// The evidence index — a MAP, not a briefing: one line per evidence path.
// ---------------------------------------------------------------------------

export interface EvidenceIndexRow {
  path: string
  note: string
  /** Instance the row is specific to (private rows are dropped); null = run-level. */
  iid: string | null
}

export interface EvidenceIndexArgs {
  outDir: string
  /** Staircase + round-summary home. */
  roundsDir: string
  /** Prior-round failure artifacts (dir + optional patch), with instance ids. */
  seedArtifactRuns: Array<{ iid: string; arm: string; dir: string; patchPath?: string }>
  /** Prior run outDirs (e.g. the gen-4 outDir) whose arm-runs/judge evidence
   *  the author may mine. */
  priorEvidenceDirs?: string[]
  /** Pareto parent diffs materialized to disk (written by the outer loop). */
  paretoParentPatches?: Array<{ label: string; path: string }>
  /** Public/private split; null = everything is public. */
  split: ScoreSplit | null
}

/** Collect the index rows. Pure over the filesystem — reads directory names
 *  only, never file contents. Private-instance rows are excluded. */
export async function collectEvidenceIndexRows(args: EvidenceIndexArgs): Promise<EvidenceIndexRow[]> {
  const priv = new Set(args.split?.privateInstances ?? [])
  const rows: EvidenceIndexRow[] = []
  const push = (path: string, note: string, iid: string | null = null): void => {
    if (iid !== null && priv.has(iid)) return
    rows.push({ path, note, iid })
  }

  // Staircase generations + round summaries (the improvement run's history).
  for (const name of (await readdir(args.roundsDir).catch(() => [])).sort()) {
    if (/^gen-\d+\.jsonl$/.test(name)) {
      push(join(args.roundsDir, name), 'staircase rows — every prior candidate: diff, per-instance verdicts, kill reasons')
    } else if (/^round\d+-summary-.*\.json$/.test(name)) {
      push(join(args.roundsDir, name), 'round summary — baseline, winner, gate reasons, cost rollup')
    }
  }

  // Prior-round seed artifacts (worker evidence, judge output, patches).
  for (const seed of args.seedArtifactRuns) {
    if (existsSync(seed.dir)) {
      push(seed.dir, `prior ${seed.arm} run for ${seed.iid} — worker evidence, journal, driver log`, seed.iid)
    }
    if (seed.patchPath && existsSync(seed.patchPath)) {
      push(seed.patchPath, `prior ${seed.arm} delivered patch for ${seed.iid}`, seed.iid)
    }
  }

  // Prior run outDirs: candidate diffs, arm runs (incl. judge.json near-miss
  // details per instance), proposer shot receipts.
  for (const dir of args.priorEvidenceDirs ?? []) {
    if (!existsSync(dir)) continue
    const candidates = join(dir, 'candidates')
    if (existsSync(candidates)) push(candidates, 'prior-run candidate diffs (one .patch per surface)')
    const armRuns = join(dir, 'arm-runs')
    for (const tag of (await readdir(armRuns).catch(() => [])).sort()) {
      for (const rep of (await readdir(join(armRuns, tag)).catch(() => [])).sort()) {
        const runsRoot = join(armRuns, tag, rep, 'runs')
        for (const iid of (await readdir(runsRoot).catch(() => [])).sort()) {
          push(
            join(runsRoot, iid),
            `prior arm run ${tag} ${rep} on ${iid} — result.json, judge.json (near-miss detail), brain.jsonl, ws/.loops worker evidence`,
            iid,
          )
        }
      }
    }
    const shots = join(dir, 'proposer-shots')
    if (existsSync(shots)) push(shots, 'prior-run proposer shot receipts (what earlier authors tried)')
  }

  // Pareto parent diffs.
  for (const parent of args.paretoParentPatches ?? []) {
    if (existsSync(parent.path)) push(parent.path, `pareto parent diff — ${parent.label}`)
  }

  return rows
}

/** Render + write `<outDir>/evidence-index.md`. Fails loud if a private
 *  instance id leaks into the rendered text (never-surfaced invariant). */
export async function writeEvidenceIndex(args: EvidenceIndexArgs): Promise<{ path: string; rows: EvidenceIndexRow[] }> {
  const rows = await collectEvidenceIndexRows(args)
  const lines: string[] = [
    `# Evidence map (${AUTHOR_BRIEFING_VERSION})`,
    '',
    'One line per evidence path. This is a MAP, not a digest — open what you need.',
    ...(args.split !== null
      ? [
          '',
          `NOTE: ${args.split.privateInstances.length} improvement instance(s) are PRIVATE this run: their`,
          'identities and per-instance evidence are withheld from authors, but your candidate is still',
          'selected on the full public+private set. Do not overfit the visible instances.',
        ]
      : []),
    '',
    ...rows.map((r) => `- ${r.path} — ${r.note}`),
    '',
  ]
  const text = lines.join('\n')
  if (args.split !== null) {
    const leaks = leaksPrivateInstance(text, args.split)
    if (leaks.length > 0) {
      throw new Error(`evidence-index: private instance id(s) leaked into the index: ${leaks.join(', ')}`)
    }
  }
  const path = join(args.outDir, EVIDENCE_INDEX_FILENAME)
  await writeFile(path, text)
  return { path, rows }
}

// ---------------------------------------------------------------------------
// The prompt section (MAP + TOOLBOX + PERMISSION), appended per author.
// ---------------------------------------------------------------------------

export interface BriefingContext {
  indexPath: string
  briefingText: string
  briefingSource: 'change-space' | 'default'
}

export function briefingPromptSection(ctx: BriefingContext): string {
  return [
    `EVIDENCE MAP: ${ctx.indexPath}`,
    'Read it first — one line per evidence path (staircase history, prior arm runs + judge near-miss',
    'details, worker evidence, parent diffs). Open the paths you need; nothing is pre-digested for you.',
    '',
    ctx.briefingText.trimEnd(),
  ].join('\n')
}
