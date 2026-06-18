[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / McpServerOptions

# Interface: McpServerOptions

Defined in: [mcp/server.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L64)

**`Experimental`**

## Properties

### coderDelegate?

> `optional` **coderDelegate?**: [`CoderDelegate`](../type-aliases/CoderDelegate.md)

Defined in: [mcp/server.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L66)

**`Experimental`**

Required to enable delegate_code.

***

### researcherDelegate?

> `optional` **researcherDelegate?**: [`ResearcherDelegate`](../type-aliases/ResearcherDelegate.md)

Defined in: [mcp/server.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L73)

**`Experimental`**

Required to enable delegate_research. The substrate cannot ship a
default — wire one that closes over your `runLoop` + a
researcher profile (typically `@tangle-network/agent-knowledge`'s
`researcherProfile` / `multiHarnessResearcherFanout`).

***

### uiAuditorDelegate?

> `optional` **uiAuditorDelegate?**: [`UiAuditorDelegate`](../type-aliases/UiAuditorDelegate.md)

Defined in: [mcp/server.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L80)

**`Experimental`**

Required to enable delegate_ui_audit. Wire one that closes over your
`runLoop` + `uiAuditorProfile` + a `SandboxClient` (the
canonical in-process choice is `createInProcessUiAuditClient` from
`@tangle-network/agent-runtime/profiles`) + your vision judge.

***

### feedbackStore?

> `optional` **feedbackStore?**: [`FeedbackStore`](FeedbackStore.md)

Defined in: [mcp/server.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L82)

**`Experimental`**

Override the default in-memory feedback store.

***

### queue?

> `optional` **queue?**: [`DelegationTaskQueue`](../classes/DelegationTaskQueue.md)

Defined in: [mcp/server.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L84)

**`Experimental`**

Override the default in-memory task queue.

***

### detachedDispatch?

> `optional` **detachedDispatch?**: `boolean`

Defined in: [mcp/server.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L93)

**`Experimental`**

Record deterministic detached-session resume keys on single-variant
coder/researcher submissions so a durable queue can resume them after a
restart. Enable only when the wired delegates dispatch via sandbox
sessions (`driveTurn`) AND `queue` persists records — the keys are inert
otherwise. The bin turns this on alongside the durable store for
session-backed (sibling/fleet) placements.

***

### extraTools?

> `optional` **extraTools?**: [`McpToolDescriptor`](McpToolDescriptor.md)[]

Defined in: [mcp/server.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L99)

**`Experimental`**

Extra tools to serve alongside the delegation tools, for example
`createCoordinationTools(...).tools`. Registered after the built-ins; a
duplicate name throws so delegation tools cannot be shadowed silently.

***

### traceContext?

> `optional` **traceContext?**: [`TraceContext`](TraceContext.md)

Defined in: [mcp/server.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L105)

**`Experimental`**

Inherited trace identity (`readTraceContextFromEnv()`) stamped on every
record the DEFAULT queue creates. Ignored when `queue` is supplied —
pass `traceContext` to that queue's constructor instead.

***

### serverName?

> `optional` **serverName?**: `string`

Defined in: [mcp/server.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L107)

**`Experimental`**

Server display name surfaced via `initialize`. Default `'agent-runtime-mcp'`.

***

### serverVersion?

> `optional` **serverVersion?**: `string`

Defined in: [mcp/server.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L109)

**`Experimental`**

Server version surfaced via `initialize`. Default = the package version baked at build time.
