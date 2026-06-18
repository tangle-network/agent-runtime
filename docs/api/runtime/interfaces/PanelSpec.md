[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PanelSpec

# Interface: PanelSpec\<Artifact, D\>

Defined in: [runtime/personify/wave-types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L208)

`panel(judges)` — M judges over ONE artifact, merged WRITE-ONLY (selector≠judge taken to its
limit). The combinator spawns the M judge children over the same input artifact, drains their
settlements, and MERGES their findings into a panel verdict via `merge` — a pure WRITE-ONLY
fold (a judge's output is never fed back to steer another judge, and the merge never re-ranks
the children behind the driver). The merged verdict gates the deliverable.

No domain: a "code review panel" and an "essay rubric panel" are the same `panel` shape under
different personas; the rubric lives in each judge persona's profile, not the combinator.

## Type Parameters

### Artifact

`Artifact`

### D

`D`

## Properties

### judges

> `readonly` **judges**: readonly [`PanelJudge`](PanelJudge.md)[]

Defined in: [runtime/personify/wave-types.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L212)

The M judge child specs: each is a persona-derived child (a narrower judge profile). The
 combinator spawns one child per entry over the SAME `artifact` and never lets one judge's
 output reach another's task (write-only).

## Methods

### judgeTask()

> **judgeTask**(`artifact`, `judge`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L214)

Build one judge child's task from the shared artifact under review + the judge descriptor.

#### Parameters

##### artifact

`Artifact`

##### judge

[`PanelJudge`](PanelJudge.md)

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

`unknown`

***

### merge()

> **merge**(`verdicts`, `artifact`): [`Outcome`](../type-aliases/Outcome.md)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L220)

Write-only merge: fold the M settled judge verdicts into the panel's terminal `Outcome<D>`.
Pure over the drained settlements — it MUST NOT spawn, re-judge, or feed one verdict into
another. A panel that reached no quorum is a concrete blocker (fail loud, never a vacuous done).

#### Parameters

##### verdicts

readonly [`PanelVerdict`](PanelVerdict.md)[]

##### artifact

`Artifact`

#### Returns

[`Outcome`](../type-aliases/Outcome.md)\<`D`\>
