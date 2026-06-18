[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeStreamEvent

# Type Alias: RuntimeStreamEvent

> **RuntimeStreamEvent** = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `timestamp`: `string`; \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `timestamp`: `string`; \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `knowledge`: `KnowledgeReadinessReport`; `decision`: `KnowledgeReadinessDecision`; `timestamp`: `string`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `questions`: `UserQuestion`[]; `timestamp`: `string`; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `acquisitionPlans`: `DataAcquisitionPlan`[]; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; `timestamp`: `string`; \} \| \{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session`: `RuntimeSession`; `timestamp`: `string`; \} \| \{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session`: `RuntimeSession`; `timestamp`: `string`; \} \| \{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `model`: `string`; `tokensIn?`: `number`; `tokensOut?`: `number`; `costUsd?`: `number`; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \} \| \{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](../interfaces/BackendErrorDetail.md); `timestamp`: `string`; \} \| \{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `status`: [`AgentTaskStatus`](AgentTaskStatus.md); `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"final"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `status`: [`AgentTaskStatus`](AgentTaskStatus.md); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](../interfaces/BackendErrorDetail.md); `timestamp`: `string`; \}

Defined in: [types.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L263)

## Union Members

### Type Literal

\{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `knowledge`: `KnowledgeReadinessReport`; `decision`: `KnowledgeReadinessDecision`; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `questions`: `UserQuestion`[]; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `acquisitionPlans`: `DataAcquisitionPlan`[]; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session`: `RuntimeSession`; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session`: `RuntimeSession`; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \}

***

### Type Literal

\{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \}

***

### Type Literal

\{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \}

***

### Type Literal

\{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \}

***

### Type Literal

\{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `model`: `string`; `tokensIn?`: `number`; `tokensOut?`: `number`; `costUsd?`: `number`; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \}

***

### Type Literal

\{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \}

***

### Type Literal

\{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \}

***

### Type Literal

\{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](../interfaces/BackendErrorDetail.md); `timestamp`: `string`; \}

#### type

> **type**: `"backend_error"`

#### task

> **task**: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md)

#### session?

> `optional` **session?**: `RuntimeSession`

#### backend

> **backend**: `string`

#### message

> **message**: `string`

#### recoverable

> **recoverable**: `boolean`

#### error?

> `optional` **error?**: [`BackendErrorDetail`](../interfaces/BackendErrorDetail.md)

Typed transport diagnostic. Present when the upstream returned a
non-success HTTP status or every retry attempt threw. Consumers MUST
surface this onto their `RunRecord.error` — silently treating a
`backend_error` as "no output" hides credit exhaustion, auth failure,
and upstream outages from operators.
 - `kind: 'transport'` — HTTP / network failure with optional `status`
   + truncated response `body`.
 - `kind: 'backend'` — the backend's `stream()` generator threw for a
   reason that isn't a recognized transport failure.

#### timestamp

> **timestamp**: `string`

***

### Type Literal

\{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `status`: [`AgentTaskStatus`](AgentTaskStatus.md); `reason`: `string`; `timestamp`: `string`; \}

***

### Type Literal

\{ `type`: `"final"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `session?`: `RuntimeSession`; `status`: [`AgentTaskStatus`](AgentTaskStatus.md); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](../interfaces/BackendErrorDetail.md); `timestamp`: `string`; \}

#### type

> **type**: `"final"`

#### task

> **task**: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md)

#### session?

> `optional` **session?**: `RuntimeSession`

#### status

> **status**: [`AgentTaskStatus`](AgentTaskStatus.md)

#### reason

> **reason**: `string`

#### text?

> `optional` **text?**: `string`

#### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

#### error?

> `optional` **error?**: [`BackendErrorDetail`](../interfaces/BackendErrorDetail.md)

Typed terminal-error diagnostic. Mirrors the `backend_error.error`
shape so a consumer that only listens for `final` still receives a
loud, structured failure when the backend never produced output. Only
set when `status !== 'completed'`. Consumers building a `RunRecord`
MUST map this to `RunRecord.error` rather than recording silent
`error: null` with empty `finalText`.

#### timestamp

> **timestamp**: `string`

## Stable
