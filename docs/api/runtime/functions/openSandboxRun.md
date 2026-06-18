[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / openSandboxRun

# Function: openSandboxRun()

> **openSandboxRun**\<`Out`\>(`client`, `options`, `deliverable`): `Promise`\<[`SandboxRun`](../interfaces/SandboxRun.md)\<`Out`\>\>

Defined in: [runtime/sandbox-run.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L104)

**`Experimental`**

Open a sandbox run. Harness-agnostic: the harness lives in
`options.agentRun.sandboxOverrides.backend.type`, so opencode/codex/claude-code/
kimi-code all flow through this one entrypoint with identical env/auth wiring.

## Type Parameters

### Out

`Out`

## Parameters

### client

[`SandboxClient`](../interfaces/SandboxClient.md)

### options

[`OpenSandboxRunOptions`](../interfaces/OpenSandboxRunOptions.md)

### deliverable

[`Deliverable`](../type-aliases/Deliverable.md)\<`Out`\>

## Returns

`Promise`\<[`SandboxRun`](../interfaces/SandboxRun.md)\<`Out`\>\>
