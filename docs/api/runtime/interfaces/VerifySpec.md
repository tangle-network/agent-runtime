[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / VerifySpec

# Interface: VerifySpec\<Task, Candidate, D\>

Defined in: [runtime/personify/wave-types.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L256)

`verify({ implement, verifier })` — the 2-node sequential gate: an IMPLEMENT child produces a
candidate, then a SEPARATE VERIFIER child's verdict GATES shippability. A `valid` verifier
verdict ships the implement deliverable; any other outcome (implement down, verifier down,
invalid verdict) becomes a concrete blocker carrying the failure verbatim — never a coerced
"done". The verifier is a distinct keystone agent (selector≠judge: the implement child does
not grade itself).

No domain: "write code then run the test gate" and "draft then fact-check" are the same `verify`
shape under different personas; the gate rubric is the verifier persona's, not the combinator's.

## Type Parameters

### Task

`Task`

### Candidate

`Candidate`

### D

`D`

## Properties

### implementLabel?

> `readonly` `optional` **implementLabel?**: `string`

Defined in: [runtime/personify/wave-types.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L264)

Implement / verifier child labels (default `implement` / `verify` in the impl).

***

### verifierLabel?

> `readonly` `optional` **verifierLabel?**: `string`

Defined in: [runtime/personify/wave-types.ts:265](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L265)

## Methods

### implement()

> **implement**(`rootTask`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L258)

Build the implement child's task from the root task.

#### Parameters

##### rootTask

`Task`

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

`unknown`

***

### verifier()

> **verifier**(`candidate`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L260)

Build the verifier child's task from the implement child's settled candidate.

#### Parameters

##### candidate

[`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`Candidate`\>\>

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

`unknown`

***

### collect()

> **collect**(`candidate`, `verdict`): [`Outcome`](../type-aliases/Outcome.md)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L262)

Project the gated (verifier-`valid`) candidate into the terminal deliverable.

#### Parameters

##### candidate

[`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`Candidate`\>\>

##### verdict

`DefaultVerdict`

#### Returns

[`Outcome`](../type-aliases/Outcome.md)\<`D`\>
