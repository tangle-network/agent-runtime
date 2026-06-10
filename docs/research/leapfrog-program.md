> **Track:** Theory (research) · **Role:** the research program's honest formal core · **Status:** v2 — rewritten after adversarial review (20-agent investigation, 2026-06-10). The breakthrough framing is RETRACTED; what survived is below.

# Is there a leapfrog here? — the honest answer

**No new theorem leapfrogs SOTA. Yes, there is a real research program — it is a
*measurement-and-mechanism* program, not a *new-mathematics* program.** A first-principles
investigation ran five deep-theory lenses, each proposing the sharpest formalizable
claims, each then attacked by an adversarial reviewer with literature access and **read
access to our own source code**. Result: **0 breakthroughs, 7 claims survived only after
being cut to narrower statements, 8 were killed.** The single most valuable output was not
a theorem at all — the attack found a live exploit in our shipped code (now fixed, #217).

This doc records what survived, what died, and why the program is still worth running.

## The meta-finding: the program's edge is the discipline, not a formalism

The investigation's best moment: an adversarial agent read `strategy.ts` and proved our
"structurally safe by construction" claim **false** — authored strategies self-reported
their score and the harness ranked on it, so a strategy could fabricate a perfect score
doing nothing (fixed in #217: scores are now harness-verified). A second pass found the
flywheel's promotion gate was a coin-flip (raw `h1>h0` on m=8; fixed: paired-bootstrap CI
margin). **An architecture where adversarial review improves the code instead of
embarrassing it is the actual asset.** That is a methods contribution, and it is real.

## What survived (three claims, each sharpened down from an overclaim)

### S1 — Channel factorization (NOT a noninterference theorem)
*Killed:* "a 0-bit critic gives a Goodhart budget of log K nats, independent of critique
depth." Refuted by our own code — strategies branch on the proxy score per shot, so
leakage composes across rounds (adaptive data analysis, not best-of-N).
*Survives:* **the `critique()` channel carries zero check-bits by construction; all
checker-directed pressure factors through the typed score surface (`ShotResult.score` +
keep-best selection).** True, code-verified. It is a clean unification (selector≠judge as
an information-flow type), not a new theorem. Value: it tells you *where* to spend a
leakage budget — on the score-fed control flow and the outer-loop author, never the
critic.

### S2 — The selection functional π is a first-class, signed term of the eval estimand
The one genuinely-unclaimed formal piece (no found paper formalizes it this way):
agent-method comparisons decompose as **Δ = strategy-effect + dose-bias +
selection-bias**, and *the same data flips sign under keep-best vs final-state scoring*
(we have two measured instances — the −9.9→+6.0pp sign-flip; the +12.6pp→tie holdout).
The policy-relevant effect is the one under the **deployment-matched** π. The conserved
pool is *blocking/standardization* over the compute channel, not randomization — state it
honestly. Value: a CONSORT-for-agents reporting standard with mechanical enforcement; this
stack is its reference implementation. (Prior art to cite, not ignore: Kapoor et al., "AI
Agents That Matter", 2407.01502 — cost-controlled comparison + inadequate-holdout
critique.)

### S3 — Retention ≠ retrieval (the memory inversion)
*Killed:* the universal "law." *Survives, as a conditional with a dose-response test:*
under finite top-k retrieval, self-corpus accretion **degrades** agent advantage whenever
(a) unconditional write precision is below a threshold set by interference cost, and
(b) self-generated items are embedding-closer to future tasks while being uncorrelated
with correctness. We **measured the divergent cell** (naive prose facts: −11.6pp,
worsening slope). The positive cell is verifier-gated + relevance-weighted accretion of
**executable, certified items** (Voyager/AWM/ExpeL). Value: it dictates the corpus's
content — *store certified programs, not prose* — and gives a falsifiable dose-response
(E3). (Cite: model-collapse "Spiral of Silence" 2404.10496; experience-following error
propagation 2505.16067.)

## What died (so the program stops chasing it)

- **Program-space-has-gradient-where-prompt-space-is-flat** — DEAD as a law. GEPA (ICLR'26
  oral) beats RL with *prompt* evolution at affordable budget; our "flat prompt" was one
  underpowered n=12 result. What survives is hygiene, not breakthrough: a **power-grounded
  coordinate-admission test** (measure mutation variance vs the paired noise floor *before*
  committing search to a coordinate — at n=24 measurement noise ≈5pp swamps naive bins). No
  published agent-search system does this; worth adopting; not a leapfrog.
- **Category-theory / functor transfer / "environment invariants are sufficient"** —
  constructively FALSIFIED (the reviewer built two environments with identical invariants
  and opposite depth-vs-breadth sign). Decorative, as flagged. Keep one sentence: strategy
  combinators preserve the budget/firewall invariants — a type fact, not a paper.
- **Spend-ratchet, dose-response κ, epistemic-Pandora, bit-metered flywheel,
  selection-quotient law** — each reduces to known work (pass@k monotonicity; Large
  Language Monkeys 2407.21787; Blum-Hardt ladder / Dwork thresholdout 2015; BBoxER
  2507.01752). Synthesis at best; not novel.

## The one sharp idea worth its own line

From the memory lens, surviving its own attack: **short programs cannot overfit a small
holdout.** The outer-loop leakage is dominated by the *losses→author-text* channel, so the
right handle is the **description length** of the promoted artifact relative to m
(Occam/PAC-Bayes). Prediction: a short DSL program (`defineStrategy`, tens of tokens)
cannot overfit m=64, while a long free-text steer/prompt can. This is an *argument for
program-space over prompt-space on generalization grounds* — orthogonal to the dead
"gradient" claim, and testable on the existing flywheel by varying authored-artifact
length against holdout-gap.

## The corrected experiment slate (all runnable here)

| id | experiment | tests |
|---|---|---|
| E1 | leakage dose-response: author sees {nothing, scores, failure-vectors} × {exact, noised} over g generations | S1 — does the holdout-gap grow with leaked bits (ADA), flattened by noised release? |
| E2 | description-length vs holdout-gap: authored programs (short) vs authored free-text steers (long), matched fitness | the sharp idea — can short programs not-overfit where long text does? |
| E3 | memory form-factor: prose-fact corpus (measured: diverges) vs certified-strategy library | S3 — does the slope flip positive when memory = programs? |
| E4 | design-violation ablations: break dose / pairing / selection one at a time | S2 — does each violation reproduce its predicted sign-flip? (2 of 3 already observed) |
| E5 | π-mismatch: score under keep-best vs final-state on the SAME runs, report both | S2 — quantify the selection-bias term directly |

E4 is nearly free (the harness already logs the components). E1/E2 are flags + a loop on
the trustworthy (#217) flywheel. None needs new infrastructure — the point of building the
instrument first.

## The bottom line for the program

The reach of everything here equals the reach of `score()` — a **deployable check**. That
is the master assumption and the honest boundary. Within it, the contribution is: a
mechanically-causal evaluation design (S2), a typed information-flow account of where
hacking can enter (S1), a memory law that says store-certified-programs (S3), and a
harness disciplined enough that adversarial review hardens it (#217). That is not a
leapfrog by sharper mathematics. It may be a leapfrog by **measurement integrity** — which
is the scarcer asset in agent research, and the one this program actually has.
