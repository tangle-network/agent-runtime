# Prove math with an AI that can't bluff

An AI writes a mathematical proof; a real theorem prover — **Lean 4** — checks it. If the proof is
wrong, Lean says exactly why, the AI reads that error and tries again, and it repeats until Lean
accepts a genuinely correct proof. Nothing is taken on the model's word: every proof that passes
here is machine-verified.

This is the automatable core of [pipeline-math](https://github.com/Pengbinghui/pipeline-math), which
used the same prover-and-checker idea to crack open mathematics problems.

## Why it matters

Ask a language model to "prove X" and it will hand you a confident, fluent, and often **wrong**
proof. Here it cannot get away with that. Lean compiles the proof and rejects anything that doesn't
actually follow — and we also reject `sorry`/`admit` (Lean's "trust me, skip this" placeholders). The
checker is ground truth, so looping against it turns a plausible-sounding guesser into a prover whose
every answer is verified.

## How it works — you don't need a special framework

A "prover-verifier loop" sounds exotic; it's two ordinary parts:

1. a **checker** — a function that returns pass/fail. Here: run the Lean compiler on the proof.
2. a **retry strategy** — show the model its failure and let it try again (`refine`, below).

Point the strategy at the checker and you have the loop. Swap Lean for unit tests and the same setup
proves *code*; swap it for a rubric and it writes *to spec*.

Two retries actually stack here: **within one attempt** the model calls a `lean_check` tool (the real
compiler) to fix its proof before answering; **across attempts** `refine` carries the last failure
forward. `sample` is the honest baseline — one blind attempt, no feedback.

## See the checker work — no API key needed

```bash
tsx src/examples/lean-proof-gate.mts --verify-only
```

This builds a Lean 4 image (first run ~3 min) and compiles five real proofs plus one deliberately
wrong one:

```
PASS  and-swap        (⟨h.2, h.1⟩)
PASS  or-swap         (h.symm)
PASS  add-comm        (by omega)
PASS  mul-one         (by simp)
PASS  reverse-reverse (by simp)
negative control (deliberately wrong): FAIL ✓ rejected
verifier: 5/5 reference proofs accepted, wrong proof rejected=true
```

The wrong proof fails with a real Lean error — `argument h.left has type p but is expected to have
type q` — which is exactly the message the AI reads and fixes.

## Run the full loop — needs a model

```bash
TANGLE_API_KEY=…  WORKER_MODEL=gpt-4.1  BUDGET=3  tsx src/examples/lean-proof-gate.mts
```

A real model proves the theorems, calling Lean to check each attempt. The report compares one blind
attempt (`sample`) against iterating on the checker's feedback (`refine`), so you can see whether the
loop actually earns its cost.

## Files

| file | what it is |
|---|---|
| `lean-proof-gate.mts` | the theorems, the checker wiring, and the run |
| `lean-verify.ts` | the checker: compile in Docker, reject `sorry`/`admit`, run with no network so a proof can't fetch its way to a pass |
| `lean.Dockerfile` | the Lean 4 toolchain image |

## Honest scope

The **checker** is real and runs on your machine today (it needs Docker). The **prover** half needs a
model key for the live loop. The theorems are small and use only core Lean (no `mathlib`) so they
compile in seconds — the point is the loop and the un-foolable check, not the difficulty of the math.
