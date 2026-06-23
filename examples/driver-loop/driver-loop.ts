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
 *     (`runLoop` increments a "round"; the multi-turn conversation primitive calls it a "turn";
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
 * Fully offline — the worker is a scripted client keyed on the prompt, so it runs with zero
 * credentials (the same offline pattern self-improving-loop uses).
 *
 * Run:  pnpm tsx examples/driver-loop/driver-loop.ts
 */

import {
  type DefaultVerdict,
  type Driver,
  type OutputAdapter,
  runLoop,
  type Validator,
} from '@tangle-network/agent-runtime/loops'
import type { AgentProfile, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'

// ── The task + what "good" means ────────────────────────────────────────────────────────
// The agent must draft a one-line release note that mentions the word "rollback". A real
// product would validate something richer; the required word keeps the example deterministic.
interface NoteTask {
  feature: string
  /** The next instruction the worker should run. The DRIVER rewrites this between shots. */
  prompt: string
}
interface NoteOutput {
  note: string
}
const requiredWord = 'rollback'

// ── The worker (scripted, offline) ──────────────────────────────────────────────────────
// A worker is just something that takes a prompt and streams back events. Here we fake it:
// the FIRST prompt produces a draft that forgets the required word (so it will be rejected);
// any prompt that mentions the required word produces a corrected draft. That keyed behavior
// is what lets the example PROVE the fold worked: shot 1 only passes because the driver put
// the right correction into the prompt.
function scriptedWorkerClient(): { create(): Promise<SandboxInstance> } {
  return {
    async create(): Promise<SandboxInstance> {
      return {
        id: `worker-${Math.random().toString(36).slice(2, 8)}`,
        async *streamPrompt(prompt: string): AsyncIterable<SandboxEvent> {
          yield {
            type: 'llm_call',
            data: { model: 'scripted', tokensIn: 200, tokensOut: 40, costUsd: 0.0006 },
          }
          // The worker "obeys" the prompt: if the driver's corrective prompt told it to
          // mention the required word, it does; otherwise it ships the naive first draft.
          const note = prompt.toLowerCase().includes(requiredWord)
            ? 'Shipped one-click restore with an instant rollback path if a deploy goes bad.'
            : 'Shipped one-click restore for failed deploys.'
          yield { type: 'result', data: { result: { note } satisfies NoteOutput } }
        },
      } as unknown as SandboxInstance
    },
  }
}

// ── The output adapter: raw event stream → typed output ─────────────────────────────────
const output: OutputAdapter<NoteOutput> = {
  parse(events: SandboxEvent[]): NoteOutput {
    for (const ev of events) {
      if (ev.type === 'result') {
        const r = (ev as { data?: { result?: unknown } }).data?.result
        if (r && typeof r === 'object' && 'note' in r) return r as NoteOutput
      }
    }
    return { note: '' }
  },
}

// ── The validator: the pass/fail check the driver reads to decide whether to refine ──────
const validator: Validator<NoteOutput> = {
  validate(out: NoteOutput): Promise<DefaultVerdict> {
    const valid = out.note.toLowerCase().includes(requiredWord)
    return Promise.resolve({
      valid,
      score: valid ? 1 : 0,
      notes: valid ? 'mentions rollback' : `missing required word "${requiredWord}"`,
    })
  },
}

// ── THE DRIVER — this is the example ────────────────────────────────────────────────────
// A driver is two functions: plan() (what to run this shot) and decide() (are we done?).
// The fold lives inside plan(): on shot > 0 it READS history (the last worker's real output
// + its verdict) and COMPOSES the next prompt FROM that output.
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

  const result = await runLoop<NoteTask, NoteOutput, NoteDecision>({
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
