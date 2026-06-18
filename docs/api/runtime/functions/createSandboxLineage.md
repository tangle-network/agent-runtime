[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createSandboxLineage

# Function: createSandboxLineage()

> **createSandboxLineage**(`client`, `capabilities`, `options?`): [`SandboxLineage`](../interfaces/SandboxLineage.md)

Defined in: [runtime/sandbox-lineage.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L189)

**`Experimental`**

Build a lineage bound to one client + its probed capabilities. The
capabilities are passed in (not re-probed) so the kernel probes once per run
and the lineage stays a pure function of "what this platform can do".

## Parameters

### client

[`SandboxClient`](../interfaces/SandboxClient.md)

### capabilities

[`SandboxCapabilities`](../interfaces/SandboxCapabilities.md)

### options?

#### maxConcurrency?

`number`

#### streaming?

`"sse"` \| `"poll"`

## Returns

[`SandboxLineage`](../interfaces/SandboxLineage.md)
