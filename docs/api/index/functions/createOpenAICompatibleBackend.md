[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / createOpenAICompatibleBackend

# Function: createOpenAICompatibleBackend()

> **createOpenAICompatibleBackend**\<`TInput`\>(`options`): [`AgentExecutionBackend`](../interfaces/AgentExecutionBackend.md)\<`TInput`\>

Defined in: [backends.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L205)

## Type Parameters

### TInput

`TInput` *extends* [`AgentBackendInput`](../interfaces/AgentBackendInput.md) = [`AgentBackendInput`](../interfaces/AgentBackendInput.md)

## Parameters

### options

#### apiKey

`string`

#### baseUrl

`string`

#### model

`string`

#### kind?

`string`

#### tools?

readonly [`OpenAIChatTool`](../interfaces/OpenAIChatTool.md)[]

OpenAI Chat Completions `tools[]` definitions surfaced to the model on
every request. Omit to send a tool-free request (existing behavior).
The runtime makes no assumption about the dispatcher — calls stream out
as `tool_call` events and the caller is responsible for executing them
and feeding `tool_result` messages back on a follow-up turn.

#### toolChoice?

[`OpenAIChatToolChoice`](../type-aliases/OpenAIChatToolChoice.md)

OpenAI Chat Completions `tool_choice`. Default `undefined` (request
omits the field; provider falls back to its own default — typically
`'auto'`).

#### fetchImpl?

(`input`, `init?`) => `Promise`\<`Response`\>

#### retry?

`BackendRetryPolicy`

## Returns

[`AgentExecutionBackend`](../interfaces/AgentExecutionBackend.md)\<`TInput`\>

## Stable

OpenAI-compat streaming backend. Routes `runAgentTaskStream` through any
`POST /chat/completions` endpoint that speaks OpenAI's SSE protocol —
Tangle Router, OpenAI direct, OpenRouter, Groq, DeepSeek, Together. The
router also fronts Anthropic models in Anthropic-native SSE shape; this
backend handles both.

### Tool calls

Pass `tools` (and optionally `toolChoice`) to forward an OpenAI Chat
Completions `tools[]` array on every request. Streamed `tool_call` chunks
are buffered until the model finalizes them (either `finish_reason:
'tool_calls'` for OpenAI shape or a `content_block_stop` for Anthropic
`tool_use` blocks proxied through the router), then emitted as a single
`tool_call` RuntimeStreamEvent with the assembled `args`.

The backend does NOT execute tools — it surfaces calls for the caller's
own dispatcher (typically the product's MCP / sandbox runtime) to fulfill
and feed back as a subsequent `messages` turn. This keeps the transport
thin and lets the agent host own tool dispatch policy.

### Fail-loud errors

Non-success HTTP responses (4xx/5xx) and exhausted retry budgets throw
`BackendTransportError` from inside the `stream()` generator. The runtime
catches the throw, yields a `backend_error` with a typed `error` field
(`kind`, `status`, truncated `body`) and a terminal `final` event with
`status: 'failed'` carrying the same detail. Consumers MUST map
`final.error` onto their `RunRecord.error` — silently treating an empty
`finalText` as "agent produced nothing" hides credit exhaustion, auth
failure, and upstream outages.
