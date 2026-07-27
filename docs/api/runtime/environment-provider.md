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

> `optional` **defaultBackend?**: `BackendType$1`

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

> `optional` **runtime?**: [`Runtime`](../runtime.md#runtime-3)

**`Experimental`**

##### destroyOnSettle?

> `optional` **destroyOnSettle?**: `boolean`

**`Experimental`**

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

**`Experimental`**

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

> **providerAsSandboxClient**(`provider`, `options?`): [`SandboxClient`](../runtime.md#sandboxclient-5)

**`Experimental`**

Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths.

#### Parameters

##### provider

`AgentEnvironmentProvider`

##### options?

[`ProviderAsSandboxClientOptions`](#providerassandboxclientoptions) = `{}`

#### Returns

[`SandboxClient`](../runtime.md#sandboxclient-5)

***

### sandboxClientAsProvider()

> **sandboxClientAsProvider**(`client`, `options?`): `AgentEnvironmentProvider`

**`Experimental`**

Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract.

#### Parameters

##### client

[`SandboxClient`](../runtime.md#sandboxclient-5)

##### options?

[`SandboxClientProviderOptions`](#sandboxclientprovideroptions) = `{}`

#### Returns

`AgentEnvironmentProvider`

***

### providerAsExecutor()

> **providerAsExecutor**(`provider`, `options?`): [`ExecutorFactory`](../runtime.md#executorfactory)\<`unknown`\>

**`Experimental`**

Adapt an environment provider into an `ExecutorFactory` for `createExecutor`.

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
