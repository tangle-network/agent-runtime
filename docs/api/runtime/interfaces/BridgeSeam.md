[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / BridgeSeam

# Interface: BridgeSeam

Defined in: [runtime/supervise/runtime.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L130)

cli-bridge seam. A local OpenAI-compatible bridge that fronts harness CLIs
(claude-code / opencode / kimi / pi) behind one HTTP surface; `model` doubles
as the harness selector (e.g. `claude-code/sonnet`, `opencode/<provider>/<model>`).
`agentProfile` is the bridge-dialect profile (metadata.disallowedTools, mcp)
forwarded verbatim per request — how an arm disables native tools or injects
a provider search MCP.

The executor opens a RESUMABLE cli-bridge session — structurally identical to the
sandbox executor's persistent box, just local. `sessionId` is the stable
caller-owned id cli-bridge maps to the harness's internal conversation id; a
follow-up steer/resume on the SAME id continues the SAME harness session (opencode
`-s`, claude `--resume`, …). Omit it and the executor mints a stable one per spawn.

## Properties

### bridgeUrl

> **bridgeUrl**: `string`

Defined in: [runtime/supervise/runtime.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L131)

***

### bridgeBearer

> **bridgeBearer**: `string`

Defined in: [runtime/supervise/runtime.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L132)

***

### model

> **model**: `string`

Defined in: [runtime/supervise/runtime.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L133)

***

### agentProfile?

> `optional` **agentProfile?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime/supervise/runtime.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L134)

***

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [runtime/supervise/runtime.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L135)

***

### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [runtime/supervise/runtime.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L138)

Stable, caller-owned cli-bridge session id for harness-side resume. Defaults
 to a freshly minted per-spawn id so each worker is its own resumable session.

***

### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: [runtime/supervise/runtime.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L141)

Per-resume-turn inference cap before the worker settles on its last output.
 Mirrors `routerToolsInlineExecutor.maxTurns`; default 200 (runaway backstop).
