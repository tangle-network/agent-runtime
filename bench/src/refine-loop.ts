/**
 * runRefineLoop — the ONE shared k-shot loop (see docs/architecture.md §1, §12).
 *
 * It replaces the seven hand-rolled `for (round 1..k) { shot → judge → decide →
 * carry-forward }` copies across the workers (~700 LOC of duplicated skeleton).
 * The worker is an OPAQUE `runShot`; this loop owns iteration, carry-forward
 * steering, optional per-round judging + early stop, and round bookkeeping.
 *
 * Two carry-forward channels, both first-class (the extraction found both in the
 * wild and they must stay pluggable):
 *   - EXECUTION CONTEXT (`Ctx`): created once by `setup`, threaded to every shot,
 *     torn down by `teardown`. This is how filesystem/session state carries — a
 *     cloned repo whose edits persist (SWE refine), a shared sandbox box whose
 *     session persists (sandbox research), or a scratch dir.
 *   - PROMPT (`prompt(round, history, ctx)`): how textual state carries — round 1
 *     is the blind prompt; rounds 2+ fold prior rounds' artifacts + a directive.
 *
 * Judging is OPTIONAL: workers that run all k rounds and let the orchestrator
 * judge omit `judge`/`decide` (the loop runs to budget); a loop that should stop
 * on the first valid answer wires `judge` (default `decide` = stop-on-valid).
 *
 * This is the inference-timescale instance of the spine's atom: `runShot` is the
 * worker Agent's `act→Output`; `prompt` is the driver Agent's `act→steer`. It is
 * deliberately corpus-agnostic — callers map `RefineLoopResult` to a RunRecord.
 */

/** Minimal per-round verdict — `valid` gates early-stop, `score` is informational. */
export interface RoundVerdict {
  valid: boolean
  score?: number
}

export interface RoundRecord<Artifact> {
  /** 1-based round index. */
  round: number
  prompt: string
  artifact: Artifact
  /** Present only when a `judge` is wired. */
  verdict?: RoundVerdict
  /** Non-fatal note (e.g. a liveness backstop fired this round). */
  note?: string
}

export interface RefineLoopSpec<Artifact, Ctx = void> {
  /** Max shots. Always ≥ 1. */
  rounds: number
  /** Build the per-task execution context once (clone repo / create box / mkdtemp). */
  setup?: () => Promise<Ctx>
  /** Round `r`'s prompt. `r === 1` is the blind prompt; `r > 1` carries `history`. */
  prompt: (round: number, history: ReadonlyArray<RoundRecord<Artifact>>, ctx: Ctx) => string
  /** Run ONE shot — the opaque worker (local spawn / sandbox stream / router chat). */
  runShot: (
    prompt: string,
    round: number,
    ctx: Ctx,
  ) => Promise<{ artifact: Artifact; note?: string }>
  /** Optional per-round judge. Omit to run all `rounds` (orchestrator judges later). */
  judge?: (artifact: Artifact, round: number) => Promise<RoundVerdict>
  /** Stop after this round? Default: stop once a round's verdict is valid (else run to budget). */
  decide?: (history: ReadonlyArray<RoundRecord<Artifact>>) => boolean
  /** Always runs (even on throw) when `setup` ran. */
  teardown?: (ctx: Ctx) => Promise<void>
}

export interface RefineLoopResult<Artifact> {
  /** Every executed round in order. */
  rounds: RoundRecord<Artifact>[]
  /** Round 1 — the blind artifact. */
  blind: RoundRecord<Artifact>
  /** The last executed round. */
  final: RoundRecord<Artifact>
  /** True iff any round was judged valid (only meaningful when `judge` is wired). */
  resolved: boolean
}

const defaultDecide = <Artifact>(history: ReadonlyArray<RoundRecord<Artifact>>): boolean =>
  history[history.length - 1]?.verdict?.valid === true

export async function runRefineLoop<Artifact, Ctx = void>(
  spec: RefineLoopSpec<Artifact, Ctx>,
): Promise<RefineLoopResult<Artifact>> {
  const rounds = Math.max(1, spec.rounds)
  const decide = spec.decide ?? defaultDecide
  let ctxSet = false
  let ctx = undefined as Ctx
  try {
    if (spec.setup) {
      ctx = await spec.setup()
      ctxSet = true
    }
    const history: RoundRecord<Artifact>[] = []
    for (let r = 1; r <= rounds; r += 1) {
      const prompt = spec.prompt(r, history, ctx)
      const { artifact, note } = await spec.runShot(prompt, r, ctx)
      const verdict = spec.judge ? await spec.judge(artifact, r) : undefined
      history.push({ round: r, prompt, artifact, verdict, note })
      if (decide(history)) break
    }
    // The loop runs ≥ 1 round, so history is non-empty.
    const blind = history[0] as RoundRecord<Artifact>
    const final = history[history.length - 1] as RoundRecord<Artifact>
    return { rounds: history, blind, final, resolved: history.some((h) => h.verdict?.valid === true) }
  } finally {
    if (ctxSet && spec.teardown) await spec.teardown(ctx)
  }
}
