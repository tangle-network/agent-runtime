[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CoderCheckInput

# Interface: CoderCheckInput

Defined in: [runtime/supervise/patch-checks.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L26)

**`Experimental`**

The patch + its derived PASS signals the mechanical gate decides on.

## Properties

### patch

> **patch**: `string`

Defined in: [runtime/supervise/patch-checks.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L28)

**`Experimental`**

The unified diff produced by the run.

***

### testsPassed

> **testsPassed**: `boolean`

Defined in: [runtime/supervise/patch-checks.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L30)

**`Experimental`**

Did `testCmd` exit clean?

***

### typecheckPassed

> **typecheckPassed**: `boolean`

Defined in: [runtime/supervise/patch-checks.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L32)

**`Experimental`**

Did `typecheckCmd` exit clean?
