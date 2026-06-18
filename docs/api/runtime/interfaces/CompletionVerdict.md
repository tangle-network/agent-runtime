[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CompletionVerdict

# Interface: CompletionVerdict

Defined in: [runtime/completion.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L35)

The "is it done?" verdict an analyst returns to the parent.

## Properties

### done

> **done**: `boolean`

Defined in: [runtime/completion.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L36)

***

### determinism

> **determinism**: `"deterministic"` \| `"probabilistic"`

Defined in: [runtime/completion.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L38)

How verifiable the claim is — sets whether the driver trusts it or validates it.

***

### reasons?

> `optional` **reasons?**: `string`

Defined in: [runtime/completion.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L40)

Why the analyst believes it is (or isn't) done — what the driver validates.

***

### confidence?

> `optional` **confidence?**: `number`

Defined in: [runtime/completion.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L42)

0..1, for probabilistic verdicts; the driver's validation threshold reads this.

***

### evidence?

> `optional` **evidence?**: readonly [`CompletionEvidence`](CompletionEvidence.md)[]

Defined in: [runtime/completion.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L43)
