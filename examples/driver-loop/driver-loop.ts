/**
 * driver-loop — SEE THE FOLD.
 *
 * The one concept that makes the whole supervisor/driver story click: a driver does not just
 * count attempts. It READS the last worker's output and WRITES the next instruction FROM it.
 * That read-then-rewrite is "the fold". supervise(), the coordination MCP, and the
 * self-improvement loop are all built on this single move.
 *
 * ── Vocabulary (one exchange, three names — all the SAME atom) ────────────────────────────
 *
 *   • shot = round = turn — ONE driver↔worker exchange:
 *
 *         driver ──prompt──▶ worker ──output (+ traces / analysis)──▶ driver
 *
 *     The driver sends a prompt, the worker runs, its output comes back, the driver reads it.
 *     (`runAgentRounds` increments a "round"; the multi-turn conversation primitive calls it a "turn";
 *      people say "shot". Same atom — pick whichever word you like.)
 *
 *   • the loop ("many shots") — a SEQUENCE of shots where each output FOLDS into the next prompt:
 *
 *         prompt0 ▶ worker ▶ output0 ▶ driver ▶ prompt1 ▶ worker ▶ output1 ▶ driver ▶ …
 *
 *     Each shot builds on the last. THIS FILE is exactly that, and it's almost always what you want.
 *
 *   • fanout (breadth / best-of-N) — a DIFFERENT axis: N independent shots with NO fold between
 *     them, keep the best. That is NOT "many shots" in the looping sense. See examples/researcher-loop.
 *
 * This file is a multi-shot REFINE driver. Shot 0 drafts a release note; the validator rejects it
 * for a missing word; the driver READS that rejected draft and BUILDS a corrective prompt from it;
 * shot 1 re-runs with that prompt and passes — proving the loop's behavior changed BECAUSE of the fold.
 *
 * Fully offline — the worker is a scripted client (in ./scripted-worker.ts, keyed on the prompt),
 * so it runs with zero credentials (the same offline pattern self-improving-loop uses).
 *
 * Run:  pnpm tsx examples/driver-loop/driver-loop.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { type Driver, runAgentRounds } from '@tangle-network/agent-runtime/kernel'
import {
  type NoteOutput,
  type NoteTask,
  output,
  requiredWord,
  scriptedWorkerClient,
  validator,
} from './scripted-worker'

// ── THE DRIVER — this is the example ────────────────────────────────────────────────────
// A driver is two functions: plan() (what to run this shot) and decide() (are we done?).
// The fold lives inside plan(): on shot > 0 it READS history (the last worker's real output
// + its verdict) and COMPOSES the next prompt FROM that output. The task + worker + validator
// it operates over live in ./scripted-worker.ts so this file shows only the fold.
//
// Decision values: the kernel STOPS the loop when decide() returns a TERMINAL value
// ('stop' | 'pick-winner' | 'fail' | 'done'). Any other string is non-terminal → the loop
// runs another shot. That's the footgun for a refine driver: if decide() returned 'fail'
// after a failing shot 0, the loop would stop BEFORE it ever got to refine. So we return the
// non-terminal 'refine' to keep going, and only the terminal 'pick-winner'/'fail' when truly done.
type NoteDecision = 'refine' | 'pick-winner' | 'fail'

function refineDriver(maxShots: number): Driver<NoteTask, NoteOutput, NoteDecision> {
  return {
    name: 'refine',
    async plan(task, history) {
      // SHOT 0 — no history yet, so just run the initial task once.
      if (history.length === 0) return [task]

      // We already passed? Stop refining (return [] → no more workers).
      const last = history[history.length - 1]
      if (last?.verdict?.valid) return []

      // Shot cap: stop even if still failing.
      if (history.length >= maxShots) return []

      // ── THE FOLD, PART 1: INGEST the last worker's actual output ────────────────────────
      // `history[history.length - 1].output` is the real answer the previous worker produced;
      // `.verdict` is how it scored. This read is what separates a driver from a counter.
      const draft = last?.output?.note ?? '(empty draft)'
      const why = last?.verdict?.notes ?? 'failed validation'

      // ── THE FOLD, PART 2: GENERATE the next prompt FROM that output ──────────────────────
      // We build the NEXT instruction out of what we just read. In a real supervisor a router
      // LLM does this composition (it reads the folded worker output via its tool-result
      // messages and writes the next spawn's prompt); here we do it in plain code so the seam
      // is visible. The corrective prompt deliberately names the required word so the scripted
      // worker can obey it — proving the loop's behavior changed BECAUSE of the fold.
      const correctedPrompt =
        `Your previous draft was: "${draft}". It was rejected because ${why}. ` +
        `Rewrite the release note for "${task.feature}" so it explicitly mentions the ` +
        `${requiredWord} path. Keep it to one line.`

      return [{ ...task, prompt: correctedPrompt }]
    },

    // decide() runs after each shot, AND once more when plan() returns [] (the finalize pass).
    //   • a valid winner exists       → 'pick-winner' (terminal: we're done, ship it)
    //   • no winner but shots remain  → 'refine'      (NON-terminal: loop runs plan() again)
    //   • no winner and out of shots  → 'fail'        (terminal: give up)
    decide(history): NoteDecision {
      if (history.some((it) => it.verdict?.valid)) return 'pick-winner'
      return history.length < maxShots ? 'refine' : 'fail'
    },
  }
}

// ── Run the refine (multi-shot) driver ──────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('driver-loop · the driver reads each shot’s output and rewrites the next prompt\n')

  const task: NoteTask = {
    feature: 'one-click restore',
    prompt: 'Write a one-line release note for the one-click restore feature.',
  }

  const result = await runAgentRounds<NoteTask, NoteOutput, NoteDecision>({
    driver: refineDriver(3),
    agentRun: {
      profile: { name: 'note-writer' } as AgentProfile,
      // Each shot's task carries the prompt the driver authored; this is how the rewritten
      // instruction actually reaches the worker.
      taskToPrompt: (t) => t.prompt,
    },
    output,
    validator,
    task,
    ctx: { sandboxClient: scriptedWorkerClient() },
    maxIterations: 5,
  })

  // One iteration == one shot here (the driver runs a single worker per shot).
  for (const it of result.iterations) {
    const verdict = it.verdict?.valid ? 'PASS' : 'reject'
    console.log(`SHOT ${it.index}: [${verdict}] note = "${it.output?.note ?? ''}"`)
    if (!it.verdict?.valid && it.index < result.iterations.length - 1) {
      console.log(`         └─ driver folds this rejected output into shot ${it.index + 1}`)
    }
  }
  console.log(`\ndecision: ${result.decision}`)
  if (result.winner) console.log(`winner: shot ${result.winner.iterationIndex}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
