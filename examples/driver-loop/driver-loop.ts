/**
 * driver-loop — SEE THE FOLD.
 *
 * This is the one concept that makes the whole supervisor/driver story click: a driver
 * does not just count iterations. It READS the last worker's actual output and WRITES the
 * next instruction FROM that output. That read-then-rewrite is "the fold". Everything else
 * in this repo — supervise(), the coordination MCP, the self-improvement loop — is built on
 * top of this single move.
 *
 * ── Vocabulary (used everywhere, defined here) ──────────────────────────────────────────
 *   • round      — one full driver cycle: plan → run workers → decide. The `runLoop` kernel
 *                  calls plan(), runs the planned workers, then calls decide(), once per round.
 *   • shot       — one independent worker attempt/sample. A round can run many shots (a fanout).
 *   • multishot  — N shots played in parallel (see SECTION 2 below).
 *   • sample     — a strategy: take the best of N shots (breadth).
 *   • refine     — a strategy: iterate-with-critique ACROSS rounds (depth) — this file's SECTION 1.
 *
 * SECTION 1 (the centerpiece) is a multi-ROUND refine driver. Round 0 asks the worker to draft
 * a release note; the validator rejects it for missing a required word; the driver READS that
 * rejected draft and BUILDS a corrective prompt from it; round 1 re-runs with that prompt and
 * passes. SECTION 2 contrasts it with a multi-SHOT run so the two axes sit side by side.
 *
 * Fully offline — the worker is a scripted client keyed on the prompt, so it runs with zero
 * credentials (the same offline pattern self-improving-loop uses).
 *
 * Run:  pnpm tsx examples/driver-loop/driver-loop.ts
 */

import {
  type MultishotPersona,
  type MultishotShape,
  runMultishot,
} from '@tangle-network/agent-eval/multishot'
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
  /** The next instruction the worker should run. The DRIVER rewrites this between rounds. */
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
// is what lets the example PROVE the fold worked: round 1 only passes because the driver put
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
// A driver is two functions: plan() (what to run this round) and decide() (are we done?).
// The fold lives inside plan(): on round > 0 it READS history (the last worker's real output
// + its verdict) and COMPOSES the next prompt FROM that output.
//
// Decision values: the kernel STOPS the loop when decide() returns a TERMINAL value
// ('stop' | 'pick-winner' | 'fail' | 'done'). Any other string is non-terminal → the loop
// runs another round. That's the footgun for a refine driver: if decide() returned 'fail'
// after a failing round 0, the loop would stop BEFORE it ever got to refine. So we return the
// non-terminal 'refine' to keep going, and only the terminal 'pick-winner'/'fail' when truly done.
type NoteDecision = 'refine' | 'pick-winner' | 'fail'

function refineDriver(maxRounds: number): Driver<NoteTask, NoteOutput, NoteDecision> {
  return {
    name: 'refine',
    async plan(task, history) {
      // ROUND 0 — no history yet, so just run the initial task once.
      if (history.length === 0) return [task]

      // We already passed? Stop refining (return [] → no more workers this round).
      const last = history[history.length - 1]
      if (last?.verdict?.valid) return []

      // Round cap: stop even if still failing.
      if (history.length >= maxRounds) return []

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

    // decide() runs after each round, AND once more when plan() returns [] (the finalize pass).
    //   • a valid winner exists        → 'pick-winner' (terminal: we're done, ship it)
    //   • no winner but rounds remain  → 'refine'      (NON-terminal: loop runs plan() again)
    //   • no winner and out of rounds  → 'fail'        (terminal: give up)
    decide(history): NoteDecision {
      if (history.some((it) => it.verdict?.valid)) return 'pick-winner'
      return history.length < maxRounds ? 'refine' : 'fail'
    },
  }
}

// ── SECTION 1: run the refine (multi-round) driver ──────────────────────────────────────
async function runRefine(): Promise<void> {
  console.log('── SECTION 1 · ROUNDS (refine) — driver reads worker output, rewrites the prompt')

  const task: NoteTask = {
    feature: 'one-click restore',
    prompt: 'Write a one-line release note for the one-click restore feature.',
  }

  const result = await runLoop<NoteTask, NoteOutput, NoteDecision>({
    driver: refineDriver(3),
    agentRun: {
      profile: { name: 'note-writer' } as AgentProfile,
      // Each round's task carries the prompt the driver authored; this is how the rewritten
      // instruction actually reaches the worker.
      taskToPrompt: (t) => t.prompt,
    },
    output,
    validator,
    task,
    ctx: { sandboxClient: scriptedWorkerClient() },
    maxIterations: 5,
  })

  // One iteration == one round here (the driver runs a single worker per round).
  for (const it of result.iterations) {
    const verdict = it.verdict?.valid ? 'PASS' : 'reject'
    console.log(`   ROUND ${it.index}: [${verdict}] note = "${it.output?.note ?? ''}"`)
    if (!it.verdict?.valid && it.index < result.iterations.length - 1) {
      console.log('            └─ driver folds this rejected output into round', it.index + 1)
    }
  }
  console.log(`   decision: ${result.decision}`)
  if (result.winner) console.log(`   winner: round ${result.winner.iterationIndex}`)
  console.log()
}

// ── SECTION 2: contrast — SHOTS (multishot), the OTHER axis ──────────────────────────────
// A round refines DEPTH-wise (each round improves on the last). A shot explores BREADTH-wise:
// N independent attempts at the SAME task, in parallel, no fold between them. runMultishot is
// the substrate primitive for that. We run it with a mocked router so it stays offline.
interface SimplePersona extends MultishotPersona {
  id: string
}
async function runShots(): Promise<void> {
  console.log('── SECTION 2 · SHOTS (multishot) — N independent attempts, no fold between them')

  const restore = installMockRouter([
    { text: 'Attempt A: one-click restore with a rollback path.' },
    { text: 'Attempt B: one-click restore, instant rollback if a deploy fails.' },
    { text: 'Attempt C: one-click restore; rollback included.' },
  ])
  process.env.TANGLE_API_KEY ??= 'test-key'
  try {
    const profile: AgentProfile = {
      name: 'note-writer',
      prompt: { systemPrompt: 'Write a one-line release note that mentions rollback.' },
    }
    const shape: MultishotShape<SimplePersona> = {
      buildOpener: () => 'Write the release note.',
      buildDriverSystemPrompt: () => 'You are drafting a release note.',
    }
    // Three personas == three shots; they run independently. There is no round-to-round fold.
    for (const id of ['shot-0', 'shot-1', 'shot-2']) {
      const res = await runMultishot({
        profile,
        persona: { id } as SimplePersona,
        shape,
        maxTurns: 1,
      })
      // Grab the worker's reply: the last non-user, non-tool message in the transcript.
      const reply = [...res.transcript]
        .reverse()
        .find((m) => m.role !== 'user' && m.role !== 'tool')
      console.log(`   ${id} (parallel): "${reply?.content ?? ''}"`)
    }
  } finally {
    restore()
  }
  console.log()
  console.log('   ROUND vs SHOT: a round folds the last output into the next prompt (depth);')
  console.log('   a shot is one independent attempt; multishot plays N shots at once (breadth).')
}

// Minimal offline router stub (same pattern as self-improving-loop) so SECTION 2 needs no creds.
function installMockRouter(replies: Array<{ text: string }>): () => void {
  const original = global.fetch
  let i = 0
  global.fetch = (async () => {
    const r = replies[i++ % replies.length]
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: r?.text ?? '' } }],
        usage: { prompt_tokens: 80, completion_tokens: 20 },
      }),
      text: async () => 'ok',
    } as Response
  }) as typeof fetch
  return () => {
    global.fetch = original
  }
}

async function main(): Promise<void> {
  await runRefine()
  await runShots()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
