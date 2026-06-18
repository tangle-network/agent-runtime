[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / ResolveCtx

# Interface: ResolveCtx

Defined in: [intelligence/resolver.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L61)

Per-call, per-tenant context the resolver reads. Everything that touches the
network, a secret, or an infra provisioner is INJECTED so the manifest carries
no live secret and the substrate-free caller wires only what it can host.

## Properties

### tenant?

> `optional` **tenant?**: `string`

Defined in: [intelligence/resolver.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L63)

Stable tenant id — namespaces billing + teardown (`tenant#target`).

***

### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/resolver.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L65)

fetch impl for http tools. Defaults to global fetch; absent ⇒ http tools fail loud.

#### Parameters

##### input

`string` \| `URL` \| `Request`

##### init?

`RequestInit`

#### Returns

`Promise`\<`Response`\>

***

### resolveSecret?

> `optional` **resolveSecret?**: (`auth`, `tenant`) => `Promise`\<\{ `succeeded`: `true`; `value`: `string`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Defined in: [intelligence/resolver.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L71)

Resolve a declared credential to a live secret for THIS tenant. Returns a
typed outcome — inspect `succeeded` before `value`. Absent ⇒ a binding that
declares non-`none` auth fails loud (never a request with no credential).

#### Parameters

##### auth

[`CapabilityAuth`](../type-aliases/CapabilityAuth.md)

##### tenant

`string` \| `undefined`

#### Returns

`Promise`\<\{ `succeeded`: `true`; `value`: `string`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

***

### runSandboxCode?

> `optional` **runSandboxCode?**: (`code`, `entry`, `args`, `task`) => `Promise`\<`string`\>

Defined in: [intelligence/resolver.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L80)

Run a `sandbox-code` body per call. Injected by the host that owns a sandbox
client (the spine does not import the sandbox executor). Absent ⇒
`sandbox-code` bindings fail loud.

#### Parameters

##### code

[`ContentRef`](../type-aliases/ContentRef.md)

##### entry

`string`

##### args

`Record`\<`string`, `unknown`\>

##### task

`unknown`

#### Returns

`Promise`\<`string`\>

***

### provisionHost?

> `optional` **provisionHost?**: (`host`, `inner`, `costTag`) => `Promise`\<[`ProvisionedHost`](ProvisionedHost.md)\>

Defined in: [intelligence/resolver.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L92)

Provision a host for a `process-on-infra` binding, then serve the inner
binding inside it. Injected by the host that owns `createExecutor`. Absent ⇒
`process-on-infra` bindings fail loud. The provider resolves the inner
binding INSIDE the host and returns the connection + a teardown.

#### Parameters

##### host

[`HostSpec`](HostSpec.md)

##### inner

[`DeliveryBinding`](../type-aliases/DeliveryBinding.md)

##### costTag

`string`

#### Returns

`Promise`\<[`ProvisionedHost`](ProvisionedHost.md)\>

***

### probeLiveToolNames?

> `optional` **probeLiveToolNames?**: (`capabilityId`) => `Promise`\<`string`[]\>

Defined in: [intelligence/resolver.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L105)

Drift probe: return the LIVE tool names a resolved surface exposes for a
given capability id (a `tools/list` over an mcp connection, the agent's
actual registered tool names for a host tool). When present, the post-resolve
drift check drops any tool/mcp whose live names diverge from the certified
interface — the only callable surfaces are gate-blessed ones. Absent ⇒ the
check enforces only the host-side executor↔spec parity (no live probe).

#### Parameters

##### capabilityId

`string`

#### Returns

`Promise`\<`string`[]\>

***

### onDrop?

> `optional` **onDrop?**: (`capabilityId`, `error`) => `void`

Defined in: [intelligence/resolver.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L113)

Observe a DROPPED capability — a per-capability resolve failure that is
fail-closed (the capability is omitted, never half-wired). The drop is the
contract; this surfaces the diagnostic so it is never silently erased. NOT
called for [CapabilityNotAdmittedError](../classes/CapabilityNotAdmittedError.md) (that rethrows — a manifest
carrying an un-admitted binding kind is a hard error, not a soft drop).

#### Parameters

##### capabilityId

`string`

##### error

`Error`

#### Returns

`void`
