# A retry loop that actually learns from failure

Most "retry on failure" code just runs the same thing again and hopes. This one is smarter: after each
attempt it **reads what the worker actually produced, sees why it was rejected, and writes a new,
corrected instruction from that output** before trying again. The same move a good engineer makes — read
the error, fix the specific thing, retry — in ~40 lines of plain, readable code.

## See it work — no API key, ~1 second

```bash
pnpm tsx examples/driver-loop/driver-loop.ts
```

The task: write a one-line release note that must mention the word "rollback".

```
SHOT 0: [reject] note = "Shipped one-click restore for failed deploys."
         └─ driver folds this rejected output into shot 1
SHOT 1: [PASS]   note = "Shipped one-click restore with an instant rollback path if a deploy goes bad."

decision: pick-winner
winner: shot 1
```

Shot 0 forgets the required word and gets rejected. The driver reads that rejected draft **and the
reason it failed**, then builds shot 1's prompt from them: *"your draft was X, it was rejected because
Y, rewrite it to mention rollback."* Shot 1 obeys and passes. Shot 1 succeeds **because** shot 0
failed — that's the whole point.

## Why it matters

That read-then-rewrite move is the core of every self-correcting agent: the difference between a loop
that blindly re-rolls the dice and one whose next attempt is *informed* by the last. This example
strips it down to plain code so you can see exactly where it happens — the two key lines are commented
`THE FOLD, PART 1: INGEST` (reads the previous output) and `THE FOLD, PART 2: GENERATE` (writes the
next prompt from it). In a production agent a model does that composition; here it's hand-written so
nothing is hidden.

## A driver is just two functions

- **`plan(task, history)`** — given everything that happened so far, what should the worker run next?
  On the first attempt there's no history, so it runs the task as-is; on later attempts it reads the
  last result and composes a corrected prompt. Returning `[]` means "stop, no more attempts."
- **`decide(history)`** — are we done? Returns `pick-winner` (a passing attempt exists, ship it),
  `fail` (out of attempts, give up), or `refine` (keep going — run `plan()` again).

```
attempt 0 ──▶ worker ──▶ output ──▶ check ──▶ (reject) ──▶ driver reads it, rewrites the prompt
attempt 1 ──▶ worker ──▶ output ──▶ check ──▶ (PASS) ──▶ pick-winner
```

## Why it runs offline

The "worker" is a scripted stand-in (`scripted-worker.ts`): if the incoming prompt mentions "rollback"
it returns the good draft, otherwise the naive one. That determinism is what lets the example *prove*
the loop worked — shot 1 can only pass if the driver folded the right correction into its prompt. No
credentials, no network, same result every run.

## Files

| file | what it is |
|---|---|
| `driver-loop.ts` | the driver — `plan()` does the read-then-rewrite, `decide()` picks when to stop |
| `scripted-worker.ts` | the offline stand-in worker, its output parser, and the pass/fail check |

## Honest scope

Everything here is real and runs for $0 — the *worker* is scripted so the loop is deterministic and
provable, but the driver, the loop kernel (`runAgentRounds`), and the winner-selection are the actual runtime
primitives. Swap the scripted worker for a live model-backed one and the same driver drives it.
