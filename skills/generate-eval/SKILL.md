---
name: generate-eval
description: Create one pinned fresh-API coding case that passes execution and defeats a no-search baseline.
---

# Generate Eval

Use this for one benchmark case that measures whether current official documentation helps a coding agent use an exact API correctly.
Do not use it for general coding quality or subjective output.

## Inputs

- `TARGET`: a pinned package version, repository commit, or release.
- `OUT`: the path for one candidate JSON object.

Read the current [candidate schema](https://github.com/tangle-network/agent-runtime/blob/main/bench/src/generate-eval/schema.ts) and [execution checks](https://github.com/tangle-network/agent-runtime/blob/main/bench/src/generate-eval/certify.ts) before authoring the candidate.
Those files define the current format and checks.
Use a maintained target for new cases, then freeze its exact identity so later runs compare the same behavior.

## Build One Case

1. Read the target's official documentation, release notes, types, and installed implementation.
2. Find one recent or niche identifier, option, behavior, or migration that a capable model could plausibly get wrong without search.
3. Pin the target exactly and record the primary source URL.
4. Write a realistic prompt that requires the detail but does not reveal it.
5. Add a minimal reference workspace that imports and exercises the real target.
6. Make the reference command fail on a no-op, deprecated form, or plausible wrong guess.
7. Add exact positive and negative answer checks only where text matching cannot be satisfied accidentally.

Never mock the target or use the candidate answer as the source of truth.
Prefer executable behavior over identifier matching.

## Calibrate

Run all of these before writing `OUT`:

1. Fresh setup plus the reference command passes in a clean workspace.
2. The correct answer passes the answer checks.
3. A plausible wrong answer fails.
4. A strong no-search baseline fails for the intended API mistake rather than setup, network, or scoring failure.
5. A search-enabled pilot can find the official source and solve the case.

Reject a case that both baselines solve, neither baseline can solve, depends on an unavailable package, leaks the answer through setup, or grades generic words.

## Output

Write exactly one schema-valid candidate to `OUT`.
Include the pinned target, source, clean setup, reference files and command, expected output, answer checks, and the observed calibration results required by the current schema.

## Then consider

- `calibrate-before-measure` before running a larger search comparison.
- `eval-engineering` when the target is a production agent capability rather than fresh API recall.
- `verify` before publishing a generated task set.
