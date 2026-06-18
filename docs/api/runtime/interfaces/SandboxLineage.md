[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SandboxLineage

# Interface: SandboxLineage

Defined in: [runtime/sandbox-lineage.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L131)

**`Experimental`**

Owns box + session handles for one loop run and offers the three
capability-gated lifecycle moves. Construct via `createSandboxLineage`.

## Methods

### start()

> **start**(`spec`, `prompt`, `signal`): `Promise`\<\{ `handle`: [`SandboxLineageHandle`](SandboxLineageHandle.md); `events`: `AsyncIterable`\<`SandboxEvent`\>; \}\>

Defined in: [runtime/sandbox-lineage.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L136)

**`Experimental`**

Acquire a fresh box and begin a new session on it. Returns the handle and
the live `streamPrompt` iterable for the first turn (caller drains it).

#### Parameters

##### spec

[`AgentRunSpec`](AgentRunSpec.md)\<`unknown`\>

##### prompt

`string`

##### signal

`AbortSignal`

#### Returns

`Promise`\<\{ `handle`: [`SandboxLineageHandle`](SandboxLineageHandle.md); `events`: `AsyncIterable`\<`SandboxEvent`\>; \}\>

***

### continue()

> **continue**(`handle`, `prompt`, `signal`): `Promise`\<`AsyncIterable`\<`SandboxEvent`, `any`, `any`\>\>

Defined in: [runtime/sandbox-lineage.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L148)

**`Experimental`**

Continue an existing handle's session with one more turn on the SAME box.
The prior context is server-side; `prompt` is only the new turn. Asserts the
session is still known to the sandbox first (fail-loud) so a platform that
silently dropped the client-minted session id surfaces as an error instead
of a contextless turn the caller mistakes for a real continuation.

#### Parameters

##### handle

[`SandboxLineageHandle`](SandboxLineageHandle.md)

##### prompt

`string`

##### signal

`AbortSignal`

#### Returns

`Promise`\<`AsyncIterable`\<`SandboxEvent`, `any`, `any`\>\>

***

### fork()

> **fork**(`parent`, `prompts`, `specs`, `signal`): `Promise`\<`object`[]\>

Defined in: [runtime/sandbox-lineage.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L164)

**`Experimental`**

Branch `count` children from `parent`. When the platform can fork, each
child inherits `parent`'s checkpoint — and therefore the parent's IMAGE and
PROFILE: under a real fork `specs[i]` does NOT re-select a per-branch
profile (the SDK forks the running box, it can't swap the image). `specs[i]`
picks the per-branch profile ONLY on the degraded fresh-box path (no CRIU).
A heterogeneous-profile fanout therefore homogenizes to the parent's profile
when fork is available — pass a single shared spec for forked fanouts, or
use `random@k` (no fork) when branches must differ. Each child's first turn
streams `prompts[i]`. Child-box creation is bounded by `maxConcurrency`.

#### Parameters

##### parent

[`SandboxLineageHandle`](SandboxLineageHandle.md)

##### prompts

`string`[]

##### specs

[`AgentRunSpec`](AgentRunSpec.md)\<`unknown`\>[]

##### signal

`AbortSignal`

#### Returns

`Promise`\<`object`[]\>

***

### prune()

> **prune**(`keep`): `Promise`\<`void`\>

Defined in: [runtime/sandbox-lineage.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L177)

**`Experimental`**

Destroy every owned box whose handle is NOT in `keep`, freeing it before
loop end. The kernel calls this after a round when it can prove no future
round will descend from the pruned boxes (deterministic, monotonic branch
selection); boxes still reachable as a future branch source are retained.
Best-effort, bounded, parallel — a failed delete never throws.

#### Parameters

##### keep

`Iterable`\<[`SandboxLineageHandle`](SandboxLineageHandle.md)\>

#### Returns

`Promise`\<`void`\>

***

### teardown()

> **teardown**(): `Promise`\<`void`\>

Defined in: [runtime/sandbox-lineage.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L179)

**`Experimental`**

Destroy every box this lineage owns. Best-effort, bounded, parallel.

#### Returns

`Promise`\<`void`\>
