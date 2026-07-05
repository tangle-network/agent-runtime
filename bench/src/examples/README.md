# Bench examples — make an AI actually earn its answer

Four runnable programs that share one idea: never trust an AI's answer on its word — put a **check**
in front of it and let the AI keep trying until the check passes. A check is just a function that
returns pass/fail (grade a number, run a test suite, compile a proof). Give the AI a check and a
compute budget and this toolkit finds the best way to spend that budget: try many answers and keep
the best, or let a critic read the failure and steer the next attempt.

All four run from the `bench/` directory (`cd bench` first). Nothing here needs a special framework —
each is a single file you can read top to bottom.

## Which one to run first

| run this | what you learn | needs a key? |
|---|---|---|
| **`strategy-demo.mts`** | the whole idea on a 20-line toy task | yes (one router key) |
| **`math-demo.mts`** | the same thing grading real answers (word problems) | yes |
| **`lean-proof-gate.mts`** | a check the AI literally cannot fool (a theorem prover) | no — offline mode |
| **`benchmark-matrix.mts`** | rank many AI agents against public benchmarks | no — offline demo |

---

## `strategy-demo.mts` — the whole idea in one small file

The smallest end-to-end demo. The task is a toy: drive a counter to exactly 5 using an `increment`
tool. Because the task is trivial, it needs only a router key — no dataset, no cloud sandbox — so you
can watch the machinery instead of the problem.

It shows three ways to use the toolkit, each a few lines:

1. **Just run it.** Hand it your task and your check; it compares the built-in ways of spending the
   budget and reports which won.
2. **Pick the tactics.** Choose from `sample` (make N independent attempts, keep the best-scoring
   one), `refine` (attempt, let a critic read what went wrong, steer the next attempt, repeat), and
   `adaptiveRefine` (refine, but abandon and restart a line that stops improving).
3. **Write your own.** `defineStrategy(name, body)` composes two moves — `shot()` (one worker
   attempt) and `critique()` (a separate reviewer reads the transcript and returns a steer) — into
   any tactic you invent. The demo authors one called `doubleCheck` in ~10 lines.

```bash
TANGLE_API_KEY=...  WORKER_MODEL=gpt-4o-mini  tsx src/examples/strategy-demo.mts
```

Prints two leaderboards: the built-in tactics, then the built-ins plus your authored `doubleCheck`,
each scored by the counter task's own check. Default model is `deepseek-v4-flash`; override with
`WORKER_MODEL`.

## `math-demo.mts` — the same toolkit grading real answers

Identical machinery, but the check now grades **answers**: three grade-school word problems, scored
by exact numeric match against the known answer. The worker gets a `calculator` tool and must submit
a final number. This is the template for any domain where success means "did the final answer come
out right" — a tax return value, a computed total, a rubric score. To move it to your domain you swap
one function: the check.

```bash
TANGLE_API_KEY=...  WORKER_MODEL=gpt-4o-mini  BUDGET=3  tsx src/examples/math-demo.mts
```

Compares `sample`, `refine`, and `sampleThenRefine` (N fresh attempts, then critique-and-iterate on
the best) at an equal budget of `BUDGET` attempts each, so you can see whether iterating on feedback
actually beats blind resampling. Needs `TANGLE_API_KEY`; default model `deepseek-v4-flash`.

## `lean-proof-gate.mts` — a check the AI cannot fool

An AI writes a mathematical proof and **Lean 4** (a real theorem prover) compiles it. A wrong proof
is rejected with a precise error the AI reads and fixes; the loop repeats until Lean accepts a
genuinely correct proof. This is the most honest check in the folder: correctness is machine-verified,
not judged by another model. It has its own full walkthrough in
[`lean-proof-gate.README.md`](./lean-proof-gate.README.md).

```bash
# See the checker work — no API key (builds a Lean image, first run ~3 min):
tsx src/examples/lean-proof-gate.mts --verify-only

# Run the full write-check-retry loop — needs a model:
TANGLE_API_KEY=...  WORKER_MODEL=gpt-4.1  BUDGET=3  tsx src/examples/lean-proof-gate.mts
```

The `--verify-only` mode compiles five real proofs plus one deliberately wrong one and shows the
wrong one getting rejected — proof the check is real before you spend a cent on a model.

## `benchmark-matrix.mts` — rank many agents across many benchmarks

The other three grade one task domain. This one builds a **leaderboard**: it runs a set of AI agents
against a set of public coding/research benchmarks (HumanEval, SWE-bench, terminal-bench, and more)
and ranks them. Each benchmark brings its **own** grader, so the score is the benchmark's, not a
number we made up. An "agent" here is a **cell** — a combination of coding harness (opencode, Codex,
a bare router call) and model (e.g. `glm-4.6`, `gpt-5`).

```bash
# Offline demo — no keys. A stub benchmark with a deterministic grader proves the
# whole pipeline and prints a ranked board:
tsx src/examples/benchmark-matrix.mts

# Live — real benchmarks graded by their real graders:
TANGLE_API_KEY=...  BENCHMARKS=humaneval  tsx src/examples/benchmark-matrix.mts
```

Pick the benchmarks with the `BENCHMARKS` env var (comma-separated). The **cells** (which
harness+model agents to rank) are the `cells` array at the top of the file — edit that array to
change who competes. Other knobs: `N` (tasks per benchmark, default 10), `CONCURRENCY` (default 4),
and `SANDBOX_BASE` if your harnesses run in a remote sandbox.

---

## Where the interesting results are

On the toy and math tasks the tactics often tie — the task is too easy for the way-you-spend-budget
to matter. The gap shows up on hard, stateful work: on an internal operations benchmark, `refine`
(iterate on a critic's feedback) beats blind `sample` by **+16.4 percentage points**. See
`bench/HARNESS.md` and `bench/src/agentic-run.mts` for that harder environment.

## The four hooks you customize

Everything above is built from four swappable pieces. To adapt any of these examples to your problem,
you change one of these and leave the rest alone:

- **the check** — your pass/fail function (grade the answer, run the tests, compile the proof).
- **the reviewer** — the prompt the critic uses to read a failed attempt and suggest a fix.
- **the worker** — the model that does the work (`WORKER_MODEL`).
- **the tactic** — how the budget is spent (`sample` / `refine` / your own `defineStrategy`).
