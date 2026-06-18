[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / RunDetachedTurnOptions

# Interface: RunDetachedTurnOptions

Defined in: [mcp/detached-turn.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L166)

**`Experimental`**

## Properties

### client

> **client**: [`SandboxClient`](../../runtime/interfaces/SandboxClient.md)

Defined in: [mcp/detached-turn.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L168)

**`Experimental`**

Sandbox client used to acquire the box (the delegate's executor client).

***

### spec

> **spec**: [`AgentRunSpec`](../../runtime/interfaces/AgentRunSpec.md)\<`unknown`\>

Defined in: [mcp/detached-turn.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L170)

**`Experimental`**

Profile + overrides for box acquisition — same spec the streaming path uses.

***

### prompt

> **prompt**: `string`

Defined in: [mcp/detached-turn.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L172)

**`Experimental`**

The full turn prompt; consumed by `driveTurn`'s dispatch leg.

***

### sessionId

> **sessionId**: `string`

Defined in: [mcp/detached-turn.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L174)

**`Experimental`**

Deterministic resume key, minted at submit time (`parseDetachedSessionRef(ref).sessionId`).

***

### signal

> **signal**: `AbortSignal`

Defined in: [mcp/detached-turn.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L181)

**`Experimental`**

***

### tickIntervalMs?

> `optional` **tickIntervalMs?**: `number`

Defined in: [mcp/detached-turn.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L184)

**`Experimental`**

Delay between `running` ticks (ms). Default 5000.

***

### wallCapMs?

> `optional` **wallCapMs?**: `number`

Defined in: [mcp/detached-turn.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L186)

**`Experimental`**

Wall-clock cap forwarded to `driveTurn` — the SDK cancels and fails a session past it.

***

### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](../../runtime/interfaces/LoopTraceEmitter.md)

Defined in: [mcp/detached-turn.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L196)

**`Experimental`**

Loop-trace sink. When set, the detached turn synthesizes a
single-iteration loop span tree (`runId` = `sessionId`, driver
`'detached-turn'`) so trace-context inheritance survives the detached
path — the same events the streaming `runLoop` path would emit, minus
per-token telemetry: `driveTurn` yields one terminal payload, so token
and cost figures are structurally unavailable and reported as 0 under
this driver tag.

***

### placement?

> `optional` **placement?**: `"sibling"` \| `"fleet"`

Defined in: [mcp/detached-turn.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L198)

**`Experimental`**

Physical placement stamped on the synthesized dispatch event. Default `'sibling'`.

## Methods

### bindSandbox()

> **bindSandbox**(`sandboxId`): `void`

Defined in: [mcp/detached-turn.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L180)

**`Experimental`**

Called once the box exists, with its sandbox id. Callers persist
`formatDetachedSessionRef({ sandboxId, sessionId })` onto the record here so
a restart can resolve the box again.

#### Parameters

##### sandboxId

`string`

#### Returns

`void`

***

### report()

> **report**(`progress`): `void`

Defined in: [mcp/detached-turn.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L182)

**`Experimental`**

#### Parameters

##### progress

[`DelegationProgress`](DelegationProgress.md)

#### Returns

`void`
