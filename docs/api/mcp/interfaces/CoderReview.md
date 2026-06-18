[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CoderReview

# Interface: CoderReview

Defined in: [mcp/delegates.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L111)

**`Experimental`**

Structured review verdict over a coder candidate.

## Properties

### approved

> **approved**: `boolean`

Defined in: [mcp/delegates.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L113)

**`Experimental`**

Gate: only approved candidates are eligible to win.

***

### recommendation

> **recommendation**: `"ship"` \| `"approve-with-nits"` \| `"changes-requested"` \| `"reject"`

Defined in: [mcp/delegates.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L115)

**`Experimental`**

Reviewer's recommendation — surfaced in traces.

***

### readiness

> **readiness**: `number`

Defined in: [mcp/delegates.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L117)

**`Experimental`**

Readiness 0..1, used by the `highest-readiness` winner-selection strategy.

***

### notes?

> `optional` **notes?**: `string`

Defined in: [mcp/delegates.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L118)

**`Experimental`**
