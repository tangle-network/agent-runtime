# Improving the agent-graphs skill: the loop, mapped onto what exists

The improving artifact is `skills/agent-graphs/SKILL.md`'s text.
Nothing below is a new framework; every step names the existing agent-eval primitive it composes, per the adopt-or-improve rule.
The only code this loop owns is two closures and a case set — the slots the machinery deliberately leaves to the caller.

## The loop

```
case (idea brief) ──► author agent + skill-vN ──► graph ──► runGraph OFFLINE ──► score ──► revise skill ──► gate ──► vN+1
```

| Step | Primitive | What the loop supplies |
| --- | --- | --- |
| Skill text as candidate surface | `MutableSurface = string` (`campaign/types.ts:210`); read `skills/agent-graphs/SKILL.md` → string | one line |
| Generate graph from case | caller-owned `dispatchWithSurface(surface, scenario, ctx)` in `runCampaign` | **closure A**: run an author agent carrying skill-vN + the case brief; return the authored graph module |
| Execute offline | `runGraph` with scripted `brain`, stub leaf seam, in-memory journal/blobs (the `examples/graphs/` pattern) | part of closure A |
| Deterministic scoring | a `JudgeConfig` closure (the `golden-matcher`/`completion-verifier` pattern) | **closure B**: score from `GraphResult` — validation passed; expected edges present with >0 traversals; ledger outcomes match the case's expectations; `exhaustedEdges` empty unless expected; deliverable verdict correct on both a passing and a failing scripted run |
| Semantic scoring (only what mechanics can't see) | `judge-panel.ts` `ensembleJudge` (cross-family, fail-loud) | rubric: role decomposition quality, directive clarity |
| Revision | `skillOptOptimizationMethod` (requires a **string** surface — skill text is first-class) or `gepa-optimization-method`; trace-conditioned diffs via `reflective-mutation.ts` | config only |
| Generations + incumbent | `runOptimization` (retains every generation's surfaces and campaigns) | config only |
| Gated promotion | `runImprovementLoop` — disjoint train/holdout enforced, no-op winner forced to hold, `autoOnPromote: 'pr'` writes the winner back as a PR | config only |
| Audit trail | `search-ledger.ts` hash-chained JSONL | free |

## Cases

`cases/` seeds seven idea-briefs, each with `expect`: the edges a correct graph must have, ledger outcomes, and whether analysts are warranted.
Case briefs are deliberately loose — "loose context in, correct graph out" is the skill's whole claim, so tidy specs would test the wrong thing.

Holdout discipline: 3 of the 7 are held out, never trained on; `runImprovementLoop` throws on overlap.

## What is deliberately NOT built

- No graph-diff scorer beyond the ledger checks — a graph is correct if it *runs* correctly offline, not if it textually matches a golden.
- No new optimizer, campaign runner, judge plumbing, or ledger — all named above.
- No live-backend scoring in the loop. Live runs are pursuit work, not skill-improvement work; the loop stays offline and free.

## Orchestration layering (doctrine, gates gen4)

Two layers, different jobs.
Foundation harnesses ship trained orchestration — Claude Code subagents, codex goal-mode, pi extensions — and prose is that layer's native API: instructing a claude-code node to "fan out subagents over these files" invokes an in-distribution capability, not vibes.
The graph/script layer exists for what no single harness provides: cross-harness composition, one conserved budget across the whole tree, durable ledger evidence, resume, and heterogeneous model placement.
Rule: outer layer coarse, inner layer maximal — one harness-sized node told to use its native fan-out beats N externally-choreographed thin nodes that duplicate setup and context while suppressing the orchestration the model was trained for.
Which harnesses qualify for native fan-out is a supervisor-lab harness-KB row, not a guess.

## Version history

The live tree carries only the current `SKILL.md`; every prior surface text is recoverable from git history via the pinned sha256s below, and each generation's full measurement record lives in `generations/`.

| gen | date | surface sha256 (short) | holdout mean | verdict |
| --- | --- | --- | --- | --- |
| 1 | 2026-08-03 | `582429a1` | 0.444 (k=3 re-measure in `generations/gen2.json`, n=9 holdout cells) | baseline |
| 2 | 2026-08-03 | `4c6615b6` | 0.611 (k=3, n=9 holdout cells); 0.600 at the gen3 k=5 re-measure | SHIP (#722) |
| 3 | 2026-08-03 | `54e7b38b` (not promoted; v2 stays live) | 0.900 — invalidated | **HOLD**: verifier found case-design contamination and scorer leniency; reasons + gen4 requirements in `generations/gen3.json` `verifierHold` |

## Known upstream gap this loop will hit

`OptimizationMethodResult` returns `winnerSurface` only — full candidate history is an owed upstream extension (recorded in discovery docs 22/25). Workaround needing no code: `runOptimization` already retains every generation's surfaces.
