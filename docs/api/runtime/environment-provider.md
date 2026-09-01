[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / runtime/environment-provider

# runtime/environment-provider

## Interfaces

### AgentEnvironmentProviderRegistry

**`Experimental`**

In-memory registry for named `AgentEnvironmentProvider` instances.

#### Methods

##### register()

> **register**(`provider`, `options?`): `void`

**`Experimental`**

###### Parameters

###### provider

`AgentEnvironmentProvider`

###### options?

###### replace?

`boolean`

###### Returns

`void`

##### has()

> **has**(`name`): `boolean`

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### get()

> **get**(`name`): `AgentEnvironmentProvider` \| `undefined`

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`AgentEnvironmentProvider` \| `undefined`

##### require()

> **require**(`name`): `AgentEnvironmentProvider`

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`AgentEnvironmentProvider`

##### names()

> **names**(): `string`[]

**`Experimental`**

###### Returns

`string`[]

##### providers()

> **providers**(): `AgentEnvironmentProvider`[]

**`Experimental`**

###### Returns

`AgentEnvironmentProvider`[]

##### capabilities()

> **capabilities**(`name`): `Promise`\<`AgentEnvironmentCapabilities`\>

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`Promise`\<`AgentEnvironmentCapabilities`\>

***

### ProviderAsSandboxClientOptions

**`Experimental`**

Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port.

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

**`Experimental`**

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

**`Experimental`**

##### requireSession?

> `optional` **requireSession?**: `boolean`

**`Experimental`**

Require declared live continuation plus concrete session controls.

##### mapCreateOptions?

> `optional` **mapCreateOptions?**: (`options`) => `Partial`\<`CreateAgentEnvironmentInput`\>

**`Experimental`**

###### Parameters

###### options

`CreateSandboxOptions` \| `undefined`

###### Returns

`Partial`\<`CreateAgentEnvironmentInput`\>

***

### SandboxClientProviderOptions

**`Experimental`**

Options for wrapping the current Tangle sandbox client as an environment provider.

#### Properties

##### name?

> `optional` **name?**: `string`

**`Experimental`**

##### defaultBackend?

> `optional` **defaultBackend?**: `BackendType`

**`Experimental`**

##### capabilities?

> `optional` **capabilities?**: `AgentEnvironmentCapabilities` \| (() => `AgentEnvironmentCapabilities` \| `Promise`\<`AgentEnvironmentCapabilities`\>)

**`Experimental`**

##### validateProfile?

> `optional` **validateProfile?**: (`profile`) => `AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

**`Experimental`**

###### Parameters

###### profile

`AgentProfileRef`

###### Returns

`AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

##### resolveProfile?

> `optional` **resolveProfile?**: (`profileId`) => `AgentProfile` \| `Promise`\<`AgentProfile`\>

**`Experimental`**

Resolve a named profile before calling Sandbox, which accepts inline profiles only.

###### Parameters

###### profileId

`string`

###### Returns

`AgentProfile` \| `Promise`\<`AgentProfile`\>

##### mapCreateInput?

> `optional` **mapCreateInput?**: (`input`) => `CreateSandboxOptions`

**`Experimental`**

###### Parameters

###### input

`CreateAgentEnvironmentInput`

###### Returns

`CreateSandboxOptions`

***

### ProviderLeafOut

**`Experimental`**

What one provider-executed turn settles on: the visible answer plus the complete event archive
the environment streamed. It is the value a `ProviderExecutorOptions.validator` scores.

#### Properties

##### content

> **content**: `string`

**`Experimental`**

##### events

> **events**: `AgentEnvironmentEvent`[]

**`Experimental`**

***

### ProviderExecutorOptions

**`Experimental`**

Options for running a provider as a supervise-mode executor.

#### Extended by

- [`ProviderSeam`](../runtime.md#providerseam)

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

**`Experimental`**

##### runtime?

> `optional` **runtime?**: [`Runtime`](../runtime.md#runtime-5)

**`Experimental`**

##### destroyOnSettle?

> `optional` **destroyOnSettle?**: `boolean`

**`Experimental`**

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

**`Experimental`**

##### promptOptions?

> `optional` **promptOptions?**: [`ProviderPromptOptions`](#providerpromptoptions)

**`Experimental`**

Per-run prompt options merged UNDER every streamed turn: a mapped turn's own field wins, and
the runtime's abort signal is applied last. `providerOptions` merges one level, so a
`taskToTurn` that sets its own provider option cannot silently drop the session credential
declared here.

##### validator?

> `optional` **validator?**: [`Validator`](../runtime.md#validator-3)\<[`ProviderLeafOut`](#providerleafout), `DefaultVerdict`\>

**`Experimental`**

OPT-IN executable score for this worker, with the SAME contract the sandbox seam's validator
has: `validate` runs while the environment is still alive, so `ValidationCtx.box` can read
files and run commands in the environment it is scoring. Every other supervised hook fires
after teardown and can only read the artifact.

The verdict becomes the settled artifact's verdict. Absent, nothing changes and the leaf falls
back to its own settle verdict.

##### profileForCreate?

> `optional` **profileForCreate?**: (`profile`) => `AgentProfile`

**`Experimental`**

Transform only the profile sent to `provider.create`. The original profile
remains the input to `taskToTurn`, so execution-only normalization cannot
rewrite the caller's task mapping.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`AgentProfile`

##### taskToTurn?

> `optional` **taskToTurn?**: (`task`, `specProfile`) => `AgentTurnInput`

**`Experimental`**

###### Parameters

###### task

`unknown`

###### specProfile

`AgentProfile`

###### Returns

`AgentTurnInput`

## Type Aliases

### AgentEnvironmentProviderRef

> **AgentEnvironmentProviderRef** = `AgentEnvironmentProvider` \| `string`

**`Experimental`**

Provider object or registry name accepted by runtime provider adapters.

***

### ProviderPromptOptions

> **ProviderPromptOptions** = `Omit`\<`PromptOptions`, `"model"` \| `"sessionId"` \| `"signal"`\>

**`Experimental`**

Per-run Sandbox prompt options for the provider path — the same field, the same name, and the
same kernel-owned exclusions as `ExecCtx.promptOptions` on the sandbox path.

The kernel owns `sessionId` and `signal`, so neither is declarable: a caller-chosen session id
would make every worker share one server session, and the abort channel belongs to the run.
`model` is excluded too, and for a different reason: this executor's materialization record
names the model from `AgentProfile`, so a turn-level override would make the record state a
model the provider did not run. Declare the instrument on `AgentProfile.model`.

Everything else is the per-call configuration a portable profile cannot carry. `backend` is the
load-bearing one: `backend.model.authMode` plus `authFiles` is how a caller-owned subscription
seat reaches the harness inside the environment. Runtime lowers these onto the turn with the one
mapper it already uses in the other direction, so a sandbox-shaped provider reads them from
`AgentTurnInput.providerOptions.backend` exactly as it reads a sandbox box's prompt options.

## Functions

### createAgentEnvironmentProviderRegistry()

> **createAgentEnvironmentProviderRegistry**(`providers?`): [`AgentEnvironmentProviderRegistry`](#agentenvironmentproviderregistry)

**`Experimental`**

Create a registry that resolves provider names to concrete provider instances.

#### Parameters

##### providers?

`Iterable`\<`AgentEnvironmentProvider`\> = `[]`

#### Returns

[`AgentEnvironmentProviderRegistry`](#agentenvironmentproviderregistry)

***

### resolveAgentEnvironmentProvider()

> **resolveAgentEnvironmentProvider**(`provider`, `registry?`): `AgentEnvironmentProvider`

**`Experimental`**

Resolve a provider instance or registry name, failing loudly when a name is unknown.

#### Parameters

##### provider

[`AgentEnvironmentProviderRef`](#agentenvironmentproviderref)

##### registry?

[`AgentEnvironmentProviderRegistry`](#agentenvironmentproviderregistry)

#### Returns

`AgentEnvironmentProvider`

***

### providerAsSandboxClient()

> **providerAsSandboxClient**(`provider`, `options?`): [`SandboxClient`](../runtime.md#sandboxclient-6)

**`Experimental`**

Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths.

#### Parameters

##### provider

`AgentEnvironmentProvider`

##### options?

[`ProviderAsSandboxClientOptions`](#providerassandboxclientoptions) = `{}`

#### Returns

[`SandboxClient`](../runtime.md#sandboxclient-6)

***

### sandboxClientAsProvider()

> **sandboxClientAsProvider**(`client`, `options?`): `AgentEnvironmentProvider`

**`Experimental`**

Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract.
The provider declares the public SDK contract before it creates an environment.
Each environment exposes interactive methods only when its deployment declares every required capability.

#### Parameters

##### client

[`SandboxClient`](../runtime.md#sandboxclient-6)

##### options?

[`SandboxClientProviderOptions`](#sandboxclientprovideroptions) = `{}`

#### Returns

`AgentEnvironmentProvider`

***

### providerAsExecutor()

> **providerAsExecutor**(`provider`, `options?`): [`ExecutorFactory`](../runtime.md#executorfactory)\<`unknown`\>

**`Experimental`**

Adapt an environment provider into an `ExecutorFactory` for `createExecutor`.

`createExecutor({ backend: 'provider', provider })` is the composition most callers want; it
builds this factory and injects the seam. See `examples/provider-executor/`.

Still `@experimental`: the entry point that consumes it, `createExecutor`, carries no stability
tag and is therefore experimental by default, so a stable promise here would be reachable only
through an experimental symbol.

#### Parameters

##### provider

`AgentEnvironmentProvider`

##### options?

[`ProviderExecutorOptions`](#providerexecutoroptions) = `{}`

#### Returns

[`ExecutorFactory`](../runtime.md#executorfactory)\<`unknown`\>

## References

### CreateTangleSandboxExactProcessProviderOptions

Re-exports [CreateTangleSandboxExactProcessProviderOptions](../runtime.md#createtanglesandboxexactprocessprovideroptions)

***

### createTangleSandboxExactProcessProvider

Re-exports [createTangleSandboxExactProcessProvider](../runtime.md#createtanglesandboxexactprocessprovider)
