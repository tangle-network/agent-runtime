[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / StrategyEvolutionConfig

# Interface: StrategyEvolutionConfig

Defined in: [runtime/strategy-evolution.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L57)

## Properties

### environment

> **environment**: [`AgenticSurface`](AgenticSurface.md)

Defined in: [runtime/strategy-evolution.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L58)

***

### tasks

> **tasks**: (`offset`, `n`) => `Promise`\<[`AgenticTask`](AgenticTask.md)[]\>

Defined in: [runtime/strategy-evolution.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L62)

Task supply by DISJOINT slice: `(offset, n)` must return n tasks unique to that
 offset range. Train draws [0, trainN); the holdout draws [trainN + holdoutOffset,
 …) — tasks the search never touched.

#### Parameters

##### offset

`number`

##### n

`number`

#### Returns

`Promise`\<[`AgenticTask`](AgenticTask.md)[]\>

***

### trainN

> **trainN**: `number`

Defined in: [runtime/strategy-evolution.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L63)

***

### holdoutN

> **holdoutN**: `number`

Defined in: [runtime/strategy-evolution.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L64)

***

### holdoutOffset?

> `optional` **holdoutOffset?**: `number`

Defined in: [runtime/strategy-evolution.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L66)

Extra offset past the train slice for the holdout draw (rotate across runs).

***

### worker

> **worker**: [`AgenticOptions`](AgenticOptions.md)

Defined in: [runtime/strategy-evolution.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L67)

***

### author

> **author**: [`EvolutionAuthor`](EvolutionAuthor.md)

Defined in: [runtime/strategy-evolution.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L68)

***

### budget?

> `optional` **budget?**: `number`

Defined in: [runtime/strategy-evolution.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L70)

Rollouts (sample) / shots (refine) per strategy per task. Default 3.

***

### concurrency?

> `optional` **concurrency?**: `number`

Defined in: [runtime/strategy-evolution.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L71)

***

### generations?

> `optional` **generations?**: `number`

Defined in: [runtime/strategy-evolution.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L73)

Author→tournament rounds after gen0. Default 2.

***

### populationSize?

> `optional` **populationSize?**: `number`

Defined in: [runtime/strategy-evolution.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L75)

Authored candidates per generation. Default 2.

***

### baselines?

> `optional` **baselines?**: [`Strategy`](Strategy.md)[]

Defined in: [runtime/strategy-evolution.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L77)

The gen0 field. Default [sample, refine, sampleThenRefine].

***

### objective?

> `optional` **objective?**: `"score"` \| `"cost"`

Defined in: [runtime/strategy-evolution.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L83)

What "better" means for PROMOTION. 'score' (default): the candidate must beat the
 incumbent's score (superiority gate). 'cost': the candidate must prove score
 NON-INFERIORITY (not worse by more than `scoreTolerance`) plus significant cost
 savings — the "same quality, cheaper" objective. The author is told the objective
 and sees per-task spend either way.

***

### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

Defined in: [runtime/strategy-evolution.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L85)

Cost objective: the score CI lower bound must clear −scoreTolerance. Default 0.05.

***

### champion?

> `optional` **champion?**: [`ChampionPolicy`](../type-aliases/ChampionPolicy.md)

Defined in: [runtime/strategy-evolution.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L87)

Search-side champion selection. Default 'costAware'.

***

### championEpsilon?

> `optional` **championEpsilon?**: `number`

Defined in: [runtime/strategy-evolution.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L89)

Score band treated as a tie under 'costAware'. Default 0.01.

***

### outDir

> **outDir**: `string`

Defined in: [runtime/strategy-evolution.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L91)

Where authored modules are written.

***

### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Defined in: [runtime/strategy-evolution.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L93)

Promotion-gate evidence floor (paired holdout tasks).

***

### band?

> `optional` **band?**: `object`

Defined in: [runtime/strategy-evolution.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L102)

BAND-AWARE scoring — concentrate the measurement where lift is possible.
 Holdout: draw `holdoutPoolN` candidate tasks and run `baselines[0]` once at the run
 budget as an INDEPENDENT reference screen; keep tasks scoring ≤ `maxRefScore`
 (headroom exists) and take the first `holdoutN`. Band membership is decided before
 either finalist touches a task and both finalists then face the SAME tasks — the
 estimand becomes "paired lift on headroom tasks", pre-registered by this config.
 Train: champion selection ignores zero-spread tasks (every field strategy scored
 identically — zero selection information, pure noise dilution).

#### holdoutPoolN

> **holdoutPoolN**: `number`

#### maxRefScore?

> `optional` **maxRefScore?**: `number`

Keep holdout tasks where the reference scores ≤ this. Default 0.99 — drop only
 tasks the reference already solves fully (no headroom, a candidate can only tie).

***

### lossesDetail?

> `optional` **lossesDetail?**: `"exact"` \| `"binary"`

Defined in: [runtime/strategy-evolution.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L111)

What the author learns from a tournament. 'exact' (default) = scores + progressions
 per task; 'binary' = pass/fail only — the leakage-bounded channel (one bit per cell
 per generation reaches the author from the evaluation data).

***

### reproducerCheck?

> `optional` **reproducerCheck?**: `object`

Defined in: [runtime/strategy-evolution.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L118)

Reproducer certification (arXiv:2606.11045): when the final champion is AUTHORED,
 compress it to a short natural-language summary, have a fresh author re-implement
 from the summary alone (no losses, no code), and score the reproduction on the same
 holdout. A reproduction gap is an overfitting signal (their detector: 100%
 sensitivity / 91% specificity in the ML-agent setting) — recorded on the report,
 never gate-blocking in v1.

#### summaryMaxWords?

> `optional` **summaryMaxWords?**: `number`

Word budget for the strategy summary. Default 64.

#### tolerance?

> `optional` **tolerance?**: `number`

Reproduction counts as faithful when reproducedScore ≥ championScore − tolerance.
 Default 0.05.

***

### checkpoint?

> `optional` **checkpoint?**: `object`

Defined in: [runtime/strategy-evolution.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L128)

Endurance: write the run state after every completed phase; with `resume`, a
 restart skips completed phases (authored modules re-imported from their files).
 Worst case after a mid-run death is re-paying ONE phase, never the run.

#### path

> **path**: `string`

#### resume?

> `optional` **resume?**: `boolean`

***

### onPhase?

> `optional` **onPhase?**: (`phase`) => `Promise`\<`void`\>

Defined in: [runtime/strategy-evolution.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L135)

Called before each benchmark phase (gen0, gen1…, band-screen, holdout, reproduce).
 The seam for environment recycling — no artifacts span phases, so a runner may
 recreate a wedge-prone environment container here.

#### Parameters

##### phase

`string`

#### Returns

`Promise`\<`void`\>

***

### onTask?

> `optional` **onTask?**: (`phase`, `row`, `done`, `total`) => `void`

Defined in: [runtime/strategy-evolution.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L136)

#### Parameters

##### phase

`string`

##### row

[`BenchmarkTaskRow`](BenchmarkTaskRow.md)

##### done

`number`

##### total

`number`

#### Returns

`void`

***

### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

Defined in: [runtime/strategy-evolution.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L137)
