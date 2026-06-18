[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RouterToolsSeam

# Interface: RouterToolsSeam

Defined in: [runtime/supervise/runtime.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L254)

Router seam WITH tool use — the tool-using router backend. Same direct
OpenAI-compatible endpoint as `RouterSeam`, but each turn passes `tools`; when
the model emits tool_calls they run via `executeToolCall` ON THIS HOST and the
results fold back as `tool` messages, repeating until the model answers without
a tool or `maxTurns` is hit. A real agentic loop, OFF-BOX — no sandbox, so it
is unaffected by a box's egress allowlist. One turn = one completion = the
equal-compute unit. `executeToolCall` receives the task so per-task tool
surfaces (e.g. a gym keyed by task) can dispatch correctly.

## Properties

### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [runtime/supervise/runtime.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L255)

***

### routerKey

> **routerKey**: `string`

Defined in: [runtime/supervise/runtime.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L256)

***

### model?

> `optional` **model?**: `string`

Defined in: [runtime/supervise/runtime.ts:257](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L257)

***

### tools

> **tools**: readonly [`ToolSpec`](ToolSpec.md)[]

Defined in: [runtime/supervise/runtime.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L258)

***

### executeToolCall

> **executeToolCall**: (`name`, `args`, `task`) => `Promise`\<`string`\>

Defined in: [runtime/supervise/runtime.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L259)

#### Parameters

##### name

`string`

##### args

`Record`\<`string`, `unknown`\>

##### task

`unknown`

#### Returns

`Promise`\<`string`\>

***

### onToolStep?

> `optional` **onToolStep?**: (`step`) => `void`

Defined in: [runtime/supervise/runtime.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L262)

Online observer of each tool step — the seam a `DetectorMonitor` taps to watch the live pipe
 (raise a `finding` when the worker loops/errors). Called after every tool call resolves.

#### Parameters

##### step

###### toolName

`string`

###### args

`Record`\<`string`, `unknown`\>

###### status

`"error"` \| `"ok"`

#### Returns

`void`

***

### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: [runtime/supervise/runtime.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L270)

Max inference turns. Default 200 (runaway backstop — set far above any
 legitimate workflow). For tighter per-workflow limits use a cost budget
 or wall-clock deadline at the call site.
