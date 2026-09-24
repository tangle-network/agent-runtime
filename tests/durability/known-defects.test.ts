/**
 * Known-defect conformance — the two durability autopsies this suite exists to keep answered.
 *
 *  A. 2026-08-11 (discovery-lab `.agent/autopsies/2026-08-11-runtime-glm-recursion-smoke-11b.md`,
 *    fixed in agent-runtime 0.132.7 / #796): during finalization of a RESUMED run, Runtime
 *    appended the root execution binding twice; the journal refused the duplicate; Runtime then
 *    replaced the root's known completion with `invalid-executor-report` and the tree settled
 *    `no-winner / driver-failed` after the work was done. The regression lock
 *    (tests/kernel/materialization-evidence.test.ts) covers the in-process rejection path; THIS
 *    case guards the cross-process signature on the real durable path: after a kill in the
 *    finalization window and a resume, the journal holds ONE root spawned record, at most ONE
 *    root materialization, root bindings under distinct attempt ids — and the run still WINS.
 *
 *  B. 2026-09-16 (discovery-lab `.agent/autopsies/2026-09-16-meta-harness-continuation.md`,
 *    agent-runtime#1225, fixed by the #1356 series): after a completed-but-unmet drive, the
 *    `repromptOnUnmet` re-entry used to hand the director ONLY the unmet-items steer. On a
 *    retained provider the session is re-attached so the steer continues a live conversation;
 *    on the NON-retained path every drive gets a NEW environment, so the director re-entered a
 *    fresh session holding a fragment — no original task, no run state. The autopsy's run spent
 *    ~20 minutes and ~2.0M input tokens re-deriving infrastructure it already had. The fix
 *    (`composeReentryTask`) composes the original task, the completion contract, and the
 *    coordinator's run state; this case pins that contract on the real re-entry path.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGraph } from '../../src/runtime/supervise/graph'
import {
  ARTIFACT_KEY,
  auditSpawnJournal,
  conformanceGraph,
  type GraphChildReport,
  type JournalAudit,
  RUN_ID,
} from '../helpers/durability/conformance-graph'

const graphChild = new URL('../helpers/durability/graph-child.ts', import.meta.url).pathname

// ── A. the 2026-08-11 signature across the finalization window ───────────────────────────────

describe('known defect: 2026-08-11 resume appended the root record twice', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'defect-0811-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // Kills that land inside or right at the edge of the finalization window: after every
  // settlement exists, around the side-effect commit, and around the submission turn.
  const windowKills = [
    'driver:turn:5:before',
    'tool:commit:after-effect',
    'driver:turn:6:before',
    'driver:turn:6:after',
  ] as const

  it.each(windowKills)(
    'kill at %s → resume still wins with one clean root record',
    {
      timeout: 120_000,
    },
    async (label: string) => {
      const phase1 = await new Promise<{
        code: number | null
        signal: NodeJS.Signals | null
        stderr: string
      }>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', graphChild, dir, '1', label], {
          cwd: process.cwd(),
          stdio: ['ignore', 'ignore', 'pipe'],
        })
        let stderr = ''
        child.stderr.setEncoding('utf8').on('data', (c: string) => {
          stderr += c
        })
        child.once('error', reject)
        child.once('close', (code, signal) => resolve({ code, signal, stderr }))
      })
      expect(phase1.signal, `phase 1 stderr: ${phase1.stderr}`).toBe('SIGKILL')

      const phase2 = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, ['--import', 'tsx', graphChild, dir, '2'], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          let stdout = ''
          let stderr = ''
          child.stdout.setEncoding('utf8').on('data', (c: string) => {
            stdout += c
          })
          child.stderr.setEncoding('utf8').on('data', (c: string) => {
            stderr += c
          })
          child.once('error', reject)
          child.once('close', (code) => resolve({ code, stdout, stderr }))
        },
      )
      expect(phase2.code, `phase 2 stderr: ${phase2.stderr}`).toBe(0)
      const line = phase2.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('{'))
        .pop()
      const report = JSON.parse(line ?? '{}') as GraphChildReport

      // The completed work was not replaced by an invalid-executor-report failure: the resumed
      // run still reaches a winner over the same output.
      expect(report.kind).toBe('winner')
      expect(report.out).toEqual({
        artifactKey: ARTIFACT_KEY,
        nodes: ['surveyor', 'builder', 'verifier'],
      })

      const final = await auditSpawnJournal(dir, RUN_ID)
      expectOneCleanRootRecord(final)
      // And the resume did not silently duplicate any committed settlement.
      expect(final.settledDoneByLabel).toEqual({ surveyor: 1, builder: 1, verifier: 1 })
    },
  )

  function expectOneCleanRootRecord(final: JournalAudit): void {
    expect(final.rootSpawned).toBe(1)
    expect(final.rootMaterialized).toBeLessThanOrEqual(1)
    expect(new Set(final.rootBoundAttemptIds).size).toBe(final.rootBoundAttemptIds.length)
    expect(final.duplicateCursorSeqs).toEqual([])
  }
})

// ── B. the 2026-09-16 re-entry contract (fix not yet on this branch) ─────────────────────────

describe('known defect: 2026-09-16 re-entry lost the director state (non-retained path)', () => {
  it('an unmet-contract re-entry carries the original task and run state, not a fragment', {
    timeout: 120_000,
  }, async () => {
    const tasks: unknown[] = []
    // A NON-RETAINED drive harness: every invocation is a fresh environment with no live
    // session to continue — the autopsy's provider shape.
    const driveHarness = async (args: { task: unknown }): Promise<void> => {
      tasks.push(args.task)
    }
    const rootProfile: AgentProfile = {
      name: 'conductor',
      harness: 'opencode',
      model: { provider: 'offline', default: 'offline/conductor' },
      prompt: { systemPrompt: 'Drive the workers.' },
      tools: {
        agent_runtime_coordination_spawn_worker: true,
        agent_runtime_coordination_await_event: true,
        agent_runtime_coordination_submit_result: true,
      },
    }
    const graph = conformanceGraph()
    // The root node goes external: the drive harness IS the director's environment.
    graph.nodes[0] = { id: 'conductor', profile: rootProfile }
    const res = await runGraph(graph, {
      runId: 'reentry-contract',
      repromptOnUnmet: 1,
      workerSlots: 3,
      maxTurns: 8,
      perWorker: { maxIterations: 20, maxTokens: 100_000 },
      driveHarness,
      makeLeafAgent: () => {
        throw new Error('the unmet-contract drive never spawns in this case')
      },
    })
    // The run completes (undelivered) after exhausting its one re-prompt.
    expect(res.result.kind).toBe('no-winner')
    expect(tasks.length).toBe(2)

    // THE CONTRACT (the shape `composeReentryTask` on fix/restore-replaced-director-workspace
    // implements): a re-entry into a FRESH environment must be self-sufficient — the original
    // task presented as the run's objective, plus the coordinator's run state (journal position,
    // live/settled workers), not the unmet-items fragment alone.
    const reentry = JSON.stringify(tasks[1])
    expect(reentry).toMatch(/original task of the run/i)
    expect(reentry).toMatch(/Journal: \d+ rows/i)
  })
})
