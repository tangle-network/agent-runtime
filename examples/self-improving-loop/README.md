# Watch an AI agent improve itself, then refuse to ship if the gain is luck

An AI agent starts out weak. It gets scored on real tasks, a second AI reads the
transcripts and diagnoses *why* it scored low, proposes a fix, the fix is applied, and the
patched agent is scored again. Then a statistical test decides whether the new version is
genuinely better or just got lucky, and only ships it if the gain is real. The whole cycle
runs in one file, offline, in about a second.

This is the loop you run to make an agent better without guessing: measure, diagnose,
patch, re-measure, and gate.

## Why it matters

"Tweak the prompt and it feels better" is how most people improve agents, and it's how you
ship regressions. Here every step is grounded. A **judge** (an LLM that scores an answer
0-10 on named qualities) turns "feels better" into numbers. A statistical **gate** compares
the old and new versions *pair by pair* and ships the new one only if the improvement is
too large to be noise. You can't fool it with one good run.

## What runs, step by step

The agent is a "content coach" that helps founders write social posts. Its first version
has a deliberately weak instruction ("give general advice"), so it scores low.

1. **Score v0.** The coach answers three simulated founders (a beverage founder, a B2B SaaS
   founder, a beauty creator). A judge scores each answer on `concreteness` (real posts vs
   vague tips) and `audience_fit` (tailored vs generic). v0 averages ~3/10.
2. **Diagnose.** An analyst reads the worst run and emits a structured root-cause note: the
   output was too generic, so *always include two ready-to-post examples*.
3. **Patch.** That recommendation is appended to the coach's instructions, producing v1.
4. **Score v1.** The three founders are re-run. v1 now writes concrete, on-domain posts and
   averages ~8.5/10.
5. **Gate.** The five-point-per-persona before/after pairs go through a paired bootstrap
   confidence interval (resample the pairs many times, keep the range the true gain falls
   in). If the low end of that range is above 0, the lift beats noise and v1 ships.

## Run it

```bash
pnpm tsx examples/self-improving-loop/self-improving-loop.ts
```

No API key needed: the model responses are scripted so the run is deterministic and offline.
Expected output:

```
═══ self-improving-loop demo ═══

— Phase 1: v0 baseline run
  v0 mean: 3.17 (over 3 personas)
    cpg-founder    composite=3.50
    b2b-saas       composite=2.50
    creator        composite=3.50

— Phase 2: analyst proposes mutation
  root cause: Theo run scored 2.5 — output was too generic, no concrete posts.
  mutation:   Always include 2 ready-to-post examples tailored to the persona's exact domain...

— Phase 3: apply mutation → v1 profile

— Phase 4: v1 re-run
  v1 mean: 8.50 (over 3 personas)

— Phase 5: gate decision
  ship: true | paired median delta: +5.00 | paired median +5.00, 95% CI [5.00, 6.00] clears 0 (n=3)

═══ PROMOTED v1 → production ═══
```

To run the same loop against a real model instead of the scripts:

```bash
TANGLE_API_KEY=sk-tan-... MOCK=0 pnpm tsx examples/self-improving-loop/self-improving-loop.ts
```

## Honest scope

Two things are stubbed so the demo is reproducible, and only two: the model's replies and
*which* fix the analyst picks. The parts that make the loop trustworthy — the judge, and the
paired-bootstrap gate — are the real functions used in production (`runJudge` and
`pairedBootstrap` from `@tangle-network/agent-eval`).

One caveat the demo makes on purpose: it gates on **3** paired points to stay small. That is
too few to trust. A confidence interval on 3 pairs can clear 0 by accident — a near-constant
gap looks significant when it isn't. A real gate refuses to decide below ~8 pairs and wants
20-50. Treat the `ship: true` here as showing the *mechanism*, not a defensible promotion.
