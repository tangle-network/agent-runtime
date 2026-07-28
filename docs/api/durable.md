[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / durable

# durable

## Interfaces

### ChatStreamEvent

The NDJSON line protocol every product chat client already speaks.

#### Properties

##### type

> **type**: `string`

##### data?

> `optional` **data?**: `Record`\<`string`, `unknown`\>

***

### ChatTurnIdentity

Identity of a chat turn. `tenantId` is the workspace id for workspace-
 scoped products and the user id for session-scoped products.

#### Properties

##### tenantId

> **tenantId**: `string`

##### sessionId

> **sessionId**: `string`

Thread / session id.

##### userId

> **userId**: `string`

##### turnIndex

> **turnIndex**: `number`

Monotonic 0-based turn index within the session.

***

### ChatTurnProducer

The live side of a turn returned by the product's `produce` hook.

#### Type Parameters

##### TEvent

`TEvent` *extends* [`ChatStreamEvent`](#chatstreamevent) = [`ChatStreamEvent`](#chatstreamevent)

#### Properties

##### stream

> **stream**: `AsyncGenerator`\<`TEvent`, `void`, `unknown`\>

The turn's event stream. Forwarded verbatim to the caller.

#### Methods

##### finalText()

> **finalText**(): `string`

The turn's final assistant text. Read once, after `stream` drains.

###### Returns

`string`

***

### ChatTurnHooks

Product callbacks invoked while one chat turn runs.

#### Methods

##### produce()

> **produce**(): [`ChatTurnProducer`](#chatturnproducer)

Build the backend stream. The engine forwards events verbatim and
 reads `finalText()` once the stream drains.

###### Returns

[`ChatTurnProducer`](#chatturnproducer)

##### persistAssistantMessage()

> **persistAssistantMessage**(`input`): `Promise`\<`void`\>

Persist the assistant message to the product's own store. Called
 once, after drain, with the assembled (transform-applied) text.

###### Parameters

###### input

###### identity

[`ChatTurnIdentity`](#chatturnidentity)

###### finalText

`string`

###### Returns

`Promise`\<`void`\>

##### onTurnComplete()?

> `optional` **onTurnComplete**(`input`): `Promise`\<`void`\>

Optional post-processing for proposals, citations, or credit metering.
 Errors are logged without failing a turn that already streamed.

###### Parameters

###### input

###### identity

[`ChatTurnIdentity`](#chatturnidentity)

###### finalText

`string`

###### Returns

`Promise`\<`void`\>

##### onEvent()?

> `optional` **onEvent**(`event`): `void` \| `Promise`\<`void`\>

Optional per-event side channel, such as a Durable Object broadcast.
 Runs for every emitted event, including the lifecycle envelope.
 Errors are logged without breaking the chat stream.

###### Parameters

###### event

[`ChatStreamEvent`](#chatstreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### transformFinalText()?

> `optional` **transformFinalText**(`text`): `string` \| `Promise`\<`string`\>

Optional pre-persist transform of the final text (e.g. PII
 redaction). Affects only what is persisted; the live stream is
 never altered.

###### Parameters

###### text

`string`

###### Returns

`string` \| `Promise`\<`string`\>

##### traceFlush()?

> `optional` **traceFlush**(): `Promise`\<`void`\>

Optional trace flush. Handed to `waitUntil` so the worker stays alive
 until export completes.

###### Returns

`Promise`\<`void`\>

***

### RunChatTurnInput

Inputs for one streamed product chat turn.

#### Properties

##### identity

> **identity**: [`ChatTurnIdentity`](#chatturnidentity)

##### hooks

> **hooks**: [`ChatTurnHooks`](#chatturnhooks)

##### waitUntil?

> `optional` **waitUntil?**: (`p`) => `void`

Worker liveness hook. When omitted, trace flush is awaited inline
 before the stream closes.

###### Parameters

###### p

`Promise`\<`unknown`\>

###### Returns

`void`

##### log?

> `optional` **log?**: (`message`, `meta?`) => `void`

Structured logger for swallowed hook errors. Defaults to
 `console.error` so failures surface without product wiring.

###### Parameters

###### message

`string`

###### meta?

`Record`\<`string`, `unknown`\>

###### Returns

`void`

***

### ChatTurnResult

HTTP response values returned for one chat turn.

#### Properties

##### body

> **body**: `ReadableStream`\<`Uint8Array`\<`ArrayBufferLike`\>\>

NDJSON body to return as the platform `Response` body.

##### contentType

> **contentType**: `"application/x-ndjson"`

Content type for the response.

## Functions

### handleChatTurn()

> **handleChatTurn**(`input`): [`ChatTurnResult`](#chatturnresult)

Run one chat turn. Returns immediately with a `ReadableStream` body;
execution starts while the stream is constructed. Backend
failures surface as `error` + `session.run.failed` events.

#### Parameters

##### input

[`RunChatTurnInput`](#runchatturninput)

#### Returns

[`ChatTurnResult`](#chatturnresult)

***

### deriveExecutionId()

> **deriveExecutionId**(`input`): `string`

Derive a stable execution id from the run identity.
The same `(projectId, sessionId, turnIndex)` tuple yields the same id.

Use the result as both `PromptOptions.executionId` and
`PromptOptions.turnId` on the first dispatch.
The execution id addresses the server-side execution for reconnect and
replay; the turn id makes a repeated dispatch idempotent.
An execution id alone does not make a repeated POST idempotent.

Format is readable, not hashed: operators grepping orchestrator logs
for `gtm-agent:thread-abc:3` find the run without translating an
opaque id. Components are URL-encoded so delimiters inside caller ids
cannot collapse distinct tuples. The final id is limited to the
orchestrator replay route's 256-byte maximum. Execution ids are not a
secrecy boundary.

Wire integration:
  - Initial dispatch: pass the result as `executionId` and `turnId`.
  - Stream replay: pass it as `executionId` with `lastEventId`.

#### Parameters

##### input

###### projectId

`string`

###### sessionId

`string`

###### turnIndex

`number`

#### Returns

`string`

#### Throws

`TypeError` when either string id is blank.

#### Throws

`RangeError` when `turnIndex` is invalid or the result exceeds 256 bytes.
