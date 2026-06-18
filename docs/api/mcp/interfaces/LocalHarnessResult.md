[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / LocalHarnessResult

# Interface: LocalHarnessResult

Defined in: [mcp/local-harness.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L143)

**`Experimental`**

## Properties

### exitCode

> **exitCode**: `number` \| `null`

Defined in: [mcp/local-harness.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L145)

**`Experimental`**

OS exit code. `null` when killed before exit.

***

### stdout

> **stdout**: `string`

Defined in: [mcp/local-harness.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L147)

**`Experimental`**

Concatenated stdout.

***

### stderr

> **stderr**: `string`

Defined in: [mcp/local-harness.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L149)

**`Experimental`**

Concatenated stderr.

***

### killedBySignal

> **killedBySignal**: `Signals` \| `null`

Defined in: [mcp/local-harness.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L151)

**`Experimental`**

Set when the process exited via signal (timeout / abort).

***

### durationMs

> **durationMs**: `number`

Defined in: [mcp/local-harness.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L153)

**`Experimental`**

Wall-clock duration ms (spawn → exit).

***

### timedOut

> **timedOut**: `boolean`

Defined in: [mcp/local-harness.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L155)

**`Experimental`**

Set when timeoutMs elapsed before exit.
