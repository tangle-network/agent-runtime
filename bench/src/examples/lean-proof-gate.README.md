# Lean prover-verifier gate — the pipeline-math pattern, on this substrate

A real **prover-verifier loop for math**: a prover model proposes a Lean 4 proof, the **real Lean
compiler** verifies it (ground truth — a wrong proof fails with a type error), the error feeds back,
and it retries until Lean accepts. This is the automatable core of
[pipeline-math](https://github.com/Pengbinghui/pipeline-math)'s "agentic Lean formalization
pipeline", built with **no new loop primitive**.

## The one idea

There is no "loop" to invent. A prover-verifier loop is just **refine-until-a-check-passes**, and
this repo already has that (`refine` over `createVerifierEnvironment` — see
[`../../../docs/canonical-api.md`](../../../docs/canonical-api.md), "'A loop' is not one thing").
The only new thing is the **verifier**: swap the `check` from a numeric compare (`math-demo.mts`) to
`lean` compiling the proof. That's the entire delta.

- **Prover** — a real model, free to iterate.
- **Verifier** — `lean-verify.ts`: assembles `${header} := ${proof}`, compiles it in a cached,
  network-isolated Docker image, passes ONLY if Lean accepts it **and** it uses no trust-escape
  (`sorry`/`admit`/`native_decide`). Deterministic; cannot be fooled.
- **Loop** — two, stacked: within a turn the model calls the `lean_check` tool (the real compiler)
  to fix its proof; across shots `refine` carries the failure forward. Both already exist.

## Proven (no model, no mocks)

`--verify-only` builds the Lean toolchain image and runs the compiler on every reference proof plus
a deliberately-wrong one:

```
$ tsx src/examples/lean-proof-gate.mts --verify-only
PASS  and-swap        (⟨h.2, h.1⟩)
PASS  or-swap         (h.symm)
PASS  add-comm        (by omega)
PASS  mul-one         (by simp)
PASS  reverse-reverse (by simp)
negative control (deliberately wrong ⟨h.1, h.2⟩): FAIL ✓ rejected
verifier: 5/5 reference proofs accepted, wrong proof rejected=true
```

Real Lean 4.31.0, installed from scratch in the container. The wrong proof fails with
`argument h.left has type p but is expected to have type q` — exactly the feedback the loop refines on.

## Run

```bash
# 1. The verifier only — deterministic, needs just Docker (builds the Lean image on first run, ~3 min):
tsx src/examples/lean-proof-gate.mts --verify-only

# 2. The full prover-verifier loop — a real agent iterating against Lean (needs a model):
TANGLE_API_KEY=…  WORKER_MODEL=gpt-4.1  BUDGET=3  tsx src/examples/lean-proof-gate.mts
```

The full run reports `sample` vs `refine` vs `sampleThenRefine` — i.e. does *iterating against the
verifier* beat one blind shot, measured on a real deterministic check.

## Honest scope

- **The verifier is real and proven here.** The **prover** half needs a model backend
  (`TANGLE_API_KEY`), so the full live loop runs against real endpoints, not in this doc.
- **No shortcuts, by construction:** the verifier fails loud with the Docker/Lean fix if the
  toolchain is missing, rejects `sorry`/`admit`, and runs with `--network none` so a proof can't
  fetch its way to a pass — mirroring the harness's "never fabricate a score" rule.
- **Next lever for maximum agent freedom:** run the prover *inside* a sandbox (the `commit0-env.ts`
  `AgenticSurface` pattern) so it can install mathlib, search, and drive `lake` itself — same
  verifier, richer prover. This example uses the leaner off-box prover + `lean_check` tool.
