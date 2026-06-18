[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SandboxClient

# Interface: SandboxClient

Defined in: [runtime/types.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L230)

**`Experimental`**

Minimal sandbox client surface the kernel calls. Satisfied structurally by
`new Sandbox({ apiKey, baseUrl })` — declared as a structural type so
tests can pass a stub without instantiating the SDK.

`describePlacement` is optional. When present, the kernel calls it after
each `create()` so the `loop.iteration.dispatch` trace event carries fleet
coordinates (fleetId + machineId) instead of just the sibling sandboxId.
Fleet-aware adapters set this; the raw `Sandbox` SDK class does not, and
the kernel falls back to `{ placement: 'sibling', sandboxId: box.id }`.

## Methods

### create()

> **create**(`options?`): `Promise`\<`SandboxInstance`\>

Defined in: [runtime/types.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L231)

**`Experimental`**

#### Parameters

##### options?

`CreateSandboxOptions`

#### Returns

`Promise`\<`SandboxInstance`\>

***

### describePlacement()?

> `optional` **describePlacement**(`box`): [`LoopSandboxPlacement`](LoopSandboxPlacement.md)

Defined in: [runtime/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L232)

**`Experimental`**

#### Parameters

##### box

`SandboxInstance`

#### Returns

[`LoopSandboxPlacement`](LoopSandboxPlacement.md)

***

### criuStatus()?

> `optional` **criuStatus**(): `Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

Defined in: [runtime/types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L243)

**`Experimental`**

Optional CRIU capability probe. When present and it resolves
`{ available: true }`, the loop's `lineage.fork` seam may checkpoint+fork a
parent box so a fanout's branches inherit a shared context prefix; absent or
`false`, the fanout degrades to independent fresh boxes. The kernel reads
this ONLY through the capability probe — it never branches on backend kind.
The raw `Sandbox` SDK class satisfies it; the loop's test fakes omit it
(⇒ `canFork = false`).

#### Returns

`Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>
