[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SandboxCapabilities

# Interface: SandboxCapabilities

Defined in: [runtime/sandbox-capabilities.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L26)

**`Experimental`**

What the loop kernel is allowed to know about a sandbox backend: a single
capability bit, never the backend's identity. `canFork` gates the
checkpoint+fork fanout path; everything else (session continuation) is a
universal SDK feature that needs no probe.

## Properties

### canFork

> **canFork**: `boolean`

Defined in: [runtime/sandbox-capabilities.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L32)

**`Experimental`**

True only when `client.criuStatus()` returned `{ available: true }`. When
false, a fork-enabled fanout degrades to independent fresh boxes — same
result, no shared context prefix.
