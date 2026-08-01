/**
 * One PHASE of a durable WAITING run, executed as its own OS process so the crash boundary in
 * `tests/runtime/wait-resume.test.ts` is a real one.
 *
 * Phase 1 arms two wait-states — a `timer` with an absolute instant ~3s out, and a `poll` on a
 * named file-existence probe — waits for both `waiting` records to be fsynced to the journal, and
 * then SIGKILLs itself. Nothing unwinds; no timer is cleared; no teardown runs.
 *
 * Phase 2 is a brand-new process pointed at the SAME dir + runId. Its only inheritance is
 * `${dir}/spawn-journal.jsonl`. It must find both waits on `Scope.resume.waits` and re-arm them by
 * LABEL — deliberately passing a FRESH spec (another 3s from now) to prove the journaled instant
 * wins. If the deadline had restarted, the timer would fire ~3s after phase 2 starts; if it is
 * intact, it fires at the instant phase 1 chose.
 *
 * Usage: `node --import tsx supervisor-wait-child.ts <dir> <runId> <phase:1|2>`
 * Both phases print one JSON line.
 */

import { existsSync } from 'node:fs'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { FileSpawnJournal } from '../../src/durable/spawn-journal'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, Scope, SpawnEvent } from '../../src/runtime/supervise/types'
import {
  createWaitProbes,
  isWaitOutcome,
  timerAt,
  type WaitOutcome,
  type WaitSpec,
} from '../../src/runtime/supervise/wait'

const [dir, runId, phase] = process.argv.slice(2)
if (dir === undefined || runId === undefined || (phase !== '1' && phase !== '2')) {
  throw new Error('usage: supervisor-wait-child.ts <dir> <runId> <1|2>')
}

/** How far out phase 1 sets the timer. Phase 2 re-arms with the SAME duration from ITS OWN start,
 *  so a restarted countdown and an intact one are separated by however long phase 1 lived plus the
 *  gap between the processes — measurable, not a guess. */
const TIMER_MS = 3_000
/** The file the test touches between the phases — the external condition the poll watches. */
const flagPath = `${dir}/ci-green.flag`

const probes = createWaitProbes({
  // A probe is resolved by NAME, which is exactly what makes it re-resolvable in a brand-new
  // process. A closure could not have survived the kill.
  'ci-green': () => existsSync(flagPath),
})

const processStart = Date.now()
const armed: Array<{ label: string; untilMs: number | undefined; armedAt: number }> = []
const resumedWaits: Array<{ label: string; untilMs: number | undefined; armedAt: number }> = []
const outcomes: WaitOutcome[] = []

const root: Agent<unknown, unknown> = {
  name: 'waiting-root',
  async act(_task: unknown, scope: Scope<unknown>): Promise<unknown> {
    for (const w of scope.resume?.waits ?? []) {
      resumedWaits.push({
        label: w.label,
        untilMs: w.spec.kind === 'timer' ? w.spec.untilMs : w.spec.timeoutAtMs,
        armedAt: w.armedAt,
      })
    }

    // The SAME two labels in both phases. Phase 2's specs are freshly computed from its own clock;
    // re-arming by label must ignore them in favour of the journaled ones.
    const specs: Array<{ label: string; spec: WaitSpec }> = [
      { label: 'timer-wait', spec: timerAt(TIMER_MS, Date.now()) },
      {
        label: 'ci-wait',
        spec: {
          kind: 'poll',
          probe: 'ci-green',
          intervalMs: 50,
          timeoutAtMs: Date.now() + 60_000,
        },
      },
    ]
    for (const s of specs) {
      const res = scope.wait(s.spec, { label: s.label })
      if (!res.ok) throw new Error(`wait '${s.label}' refused: ${res.reason}`)
      const node = scope.view.nodes.find((n) => n.id === res.handle.id)
      if (node?.status !== 'waiting')
        throw new Error(`wait '${s.label}' is not in 'waiting' status`)
      armed.push({
        label: s.label,
        untilMs: s.spec.kind === 'timer' ? s.spec.untilMs : s.spec.timeoutAtMs,
        armedAt: Date.now(),
      })
    }

    if (phase === '1') {
      // Die only once BOTH `waiting` records are fsynced — otherwise the kill would be racing the
      // journal write and the test would be proving nothing about durability.
      await killOnceJournaled()
      await new Promise<never>(() => {})
    }

    for (let s = await scope.next(); s !== null; s = await scope.next()) {
      if (s.kind === 'done' && isWaitOutcome(s.out)) outcomes.push(s.out)
    }
    return outcomes.length > 0 ? 'woke' : undefined
  },
}

/** Poll the on-disk journal until both waits are recorded, then SIGKILL — the hard boundary. */
async function killOnceJournaled(): Promise<void> {
  const journal = new FileSpawnJournal(`${dir}/spawn-journal.jsonl`)
  for (;;) {
    const events: SpawnEvent[] | undefined = await journal.loadTree(runId)
    if ((events ?? []).filter((e) => e.kind === 'waiting').length >= 2) {
      process.kill(process.pid, 'SIGKILL')
    }
    await new Promise<void>((r) => setTimeout(r, 10))
  }
}

const ctx = createFileRunContext(dir)
const result = await createSupervisor<unknown, unknown>().run(root, 'task', {
  budget: { maxIterations: 50, maxTokens: 100_000 },
  rootIdentity: {
    profileDigest: canonicalCandidateDigest({ name: root.name }),
    taskDigest: canonicalCandidateDigest('task'),
  },
  runId,
  ...ctx,
  probes,
})

process.stdout.write(
  `${JSON.stringify({
    phase,
    kind: result.kind,
    processStart,
    timerMs: TIMER_MS,
    armed,
    resumedWaits,
    outcomes,
  })}\n`,
)
