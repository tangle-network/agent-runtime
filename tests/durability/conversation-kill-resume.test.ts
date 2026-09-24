/**
 * Conversation kill-and-resume conformance — `FileConversationJournal` and
 * `SqlConversationJournal` over a REAL sqlite file (node:sqlite), the two shipped durable
 * backends for the conversation layer (`runConversation`).
 *
 * Case matrix: every turn boundary and mid-turn instant of a 6-turn, 2-participant reference run
 * (turn start, backend-complete-before-commit, turn-committed). For each label × backend: phase 1
 * SIGKILLs itself there; phase 2 is a brand-new process resuming the same runId against the same
 * journal. The conformance contract, per case:
 *
 *   1. the resumed conversation COMPLETES (all 6 turns) with the SAME final transcript;
 *   2. no turn is LOST or REPEATED — the journal holds exactly turns 0..5, each once, each under
 *      its deterministic turn id;
 *   3. the keyed side effect commits EXACTLY ONCE per turn id — a turn re-run after a mid-turn
 *      kill re-invokes under the SAME id and the effect site dedupes;
 *   4. a journal that already recorded a halt replays its final state instead of re-running.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type BackendKind,
  CONV_TURNS,
  type ConversationChildReport,
  expectedTurnIds,
  openJournal,
} from '../helpers/durability/conformance-conversation'
import { readLabels } from '../helpers/durability/kill-switch'

const childScript = new URL('../helpers/durability/conversation-child.ts', import.meta.url).pathname
const BACKENDS: BackendKind[] = ['file', 'sqlite']

interface PhaseExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

async function runPhase(
  dir: string,
  phase: '1' | '2',
  backend: BackendKind,
  killAt?: string,
): Promise<PhaseExit> {
  return await new Promise<PhaseExit>((resolvePhase, rejectPhase) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        childScript,
        dir,
        phase,
        backend,
        ...(phase === '1' ? [killAt ?? '-'] : []),
      ],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (c: string) => {
      stdout += c
    })
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      stderr += c
    })
    child.once('error', rejectPhase)
    child.once('close', (code, signal) => resolvePhase({ code, signal, stdout, stderr }))
  })
}

function parseReport(stdout: string): ConversationChildReport {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .pop()
  if (line === undefined) throw new Error(`child printed no report line: ${stdout.slice(0, 500)}`)
  return JSON.parse(line) as ConversationChildReport
}

// ── Reference runs per backend, at module scope so their labels parametrize the cases ───────

const references = new Map<BackendKind, { report: ConversationChildReport; labels: string[] }>()
for (const backend of BACKENDS) {
  const refDir = await mkdtemp(join(tmpdir(), `conv-kill-resume-ref-${backend}-`))
  const exit = await runPhase(refDir, '1', backend)
  if (exit.code !== 0) throw new Error(`reference run (${backend}) failed: ${exit.stderr}`)
  const report = parseReport(exit.stdout)
  references.set(backend, { report, labels: readLabels(`${refDir}/labels-phase-1.log`) })
  await rm(refDir, { recursive: true, force: true })
}

const cases: Array<[BackendKind, string]> = BACKENDS.flatMap((backend) =>
  (references.get(backend)?.labels ?? []).map((label) => [backend, label] as [BackendKind, string]),
)

describe('runConversation kill-and-resume conformance (File + Sql journals)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conv-kill-resume-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  afterAll(() => {
    for (const backend of BACKENDS) {
      console.log(
        `conversation case matrix (${backend}, ${references.get(backend)?.labels.length} labels): ` +
          `${(references.get(backend)?.labels ?? []).join(', ')}`,
      )
    }
  })

  it.each(BACKENDS)(
    'reference run (%s backend) completes with the expected transcript',
    (backend) => {
      const ref = references.get(backend)?.report
      if (ref === undefined) throw new Error(`missing reference for ${backend}`)
      expect(ref.haltedKind).toBe('max_turns')
      expect(ref.turns).toBe(CONV_TURNS)
      expect(ref.texts).toEqual([
        'alpha-says-0',
        'beta-says-1',
        'alpha-says-2',
        'beta-says-3',
        'alpha-says-4',
        'beta-says-5',
      ])
      expect(ref.committedEffects).toEqual(expectedTurnIds())
    },
  )

  it.each(cases)(
    '%s journal: SIGKILL at %s → resume completes, nothing lost or repeated',
    {
      timeout: 60_000,
    },
    async (backend: BackendKind, label: string) => {
      // ── Phase 1: die, exactly at the labeled instant ───────────────────────────────────
      const killed = await runPhase(dir, '1', backend, label)
      expect(killed.signal, `phase 1 should die by SIGKILL, got code=${killed.code}`).toBe(
        'SIGKILL',
      )
      expect(await readFile(join(dir, 'killed.log'), 'utf8')).toBe(`${label}\n`)

      // ── Phase 2: a brand-new process resumes the same runId + journal ──────────────────
      const resumed = await runPhase(dir, '2', backend)
      expect(resumed.code, `phase 2 stderr: ${resumed.stderr}`).toBe(0)
      const report = parseReport(resumed.stdout)

      // 1. Completes with the SAME final transcript.
      expect(report.haltedKind).toBe('max_turns')
      expect(report.turns).toBe(CONV_TURNS)
      expect(report.texts).toEqual(references.get(backend)?.report.texts)

      // 2. No turn lost or repeated — the journal is the ground truth.
      const journal = openJournal(dir, backend)
      try {
        const entry = await journal.loadRun('conformance-conv')
        expect(entry).toBeDefined()
        const committed = entry?.turns ?? []
        expect(committed.map((t) => t.index)).toEqual([...Array(CONV_TURNS).keys()])
        expect(new Set(committed.map((t) => t.index)).size).toBe(CONV_TURNS)
        expect(committed.map((t) => t.text)).toEqual(references.get(backend)?.report.texts)
        expect(committed.map((t) => t.turnId)).toEqual(expectedTurnIds())
      } finally {
        journal.close()
      }

      // 3. Side effect exactly once per turn id (re-invocations deduped, keys never reminted).
      expect([...new Set(report.committedEffects)].sort()).toEqual([...expectedTurnIds()].sort())
      expect(report.committedEffects.length).toBe(expectedTurnIds().length)
      const invocationLines = (await readFile(join(dir, 'side-effect-invocations.jsonl'), 'utf8'))
        .split('\n')
        .filter((l) => l.length > 0)
      expect(invocationLines.length).toBeGreaterThanOrEqual(CONV_TURNS)
      for (const line of invocationLines) {
        expect(expectedTurnIds()).toContain((JSON.parse(line) as { key: string }).key)
      }
    },
  )

  it('a journal that already recorded a halt replays its final state instead of re-running', {
    timeout: 60_000,
  }, async () => {
    // Complete a run against the file journal, then start a "resume" against the same runId.
    const first = await runPhase(dir, '1', 'file')
    expect(first.code).toBe(0)
    const again = await runPhase(dir, '2', 'file')
    expect(again.code, `stderr: ${again.stderr}`).toBe(0)
    const report = parseReport(again.stdout)
    // The replayed run returns the recorded final transcript WITHOUT any new side effects.
    expect(report.turns).toBe(CONV_TURNS)
    expect(report.haltedKind).toBe('max_turns')
    expect(report.texts).toEqual(references.get('file')?.report.texts)
    expect(report.committedEffects).toEqual(expectedTurnIds())
    const invocations = (await readFile(join(dir, 'side-effect-invocations.jsonl'), 'utf8'))
      .split('\n')
      .filter((l) => l.length > 0)
    expect(invocations, 'a halted run must not re-run any turn or effect').toHaveLength(CONV_TURNS)
  })
})
