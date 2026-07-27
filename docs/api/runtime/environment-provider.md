[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / runtime/environment-provider

# runtime/environment-provider

## Interfaces

### AgentEnvironmentProviderRegistry

Defined in: src/runtime/environment-provider.ts:96

**`Experimental`**

In-memory registry for named `AgentEnvironmentProvider` instances.

#### Methods

##### register()

> **register**(`provider`, `options?`): `void`

Defined in: src/runtime/environment-provider.ts:97

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

Defined in: src/runtime/environment-provider.ts:98

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### get()

> **get**(`name`): `AgentEnvironmentProvider` \| `undefined`

Defined in: src/runtime/environment-provider.ts:99

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`AgentEnvironmentProvider` \| `undefined`

##### require()

> **require**(`name`): `AgentEnvironmentProvider`

Defined in: src/runtime/environment-provider.ts:100

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`AgentEnvironmentProvider`

##### names()

> **names**(): `string`[]

Defined in: src/runtime/environment-provider.ts:101

**`Experimental`**

###### Returns

`string`[]

##### providers()

> **providers**(): `AgentEnvironmentProvider`[]

Defined in: src/runtime/environment-provider.ts:102

**`Experimental`**

###### Returns

`AgentEnvironmentProvider`[]

##### capabilities()

> **capabilities**(`name`): `Promise`\<`AgentEnvironmentCapabilities`\>

Defined in: src/runtime/environment-provider.ts:103

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`Promise`\<`AgentEnvironmentCapabilities`\>

***

### ProviderAsSandboxClientOptions

Defined in: src/runtime/environment-provider.ts:174

**`Experimental`**

Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port.

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: src/runtime/environment-provider.ts:175

**`Experimental`**

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

Defined in: src/runtime/environment-provider.ts:176

**`Experimental`**

##### mapCreateOptions?

> `optional` **mapCreateOptions?**: (`options`) => `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: src/runtime/environment-provider.ts:177

**`Experimental`**

###### Parameters

###### options

`CreateSandboxOptions` \| `undefined`

###### Returns

`Partial`\<`CreateAgentEnvironmentInput`\>

***

### SandboxClientProviderOptions

Defined in: src/runtime/environment-provider.ts:210

**`Experimental`**

Options for wrapping the current Tangle sandbox client as an environment provider.

#### Properties

##### name?

> `optional` **name?**: `string`

Defined in: src/runtime/environment-provider.ts:211

**`Experimental`**

##### defaultBackend?

> `optional` **defaultBackend?**: `BackendType$1`

Defined in: src/runtime/environment-provider.ts:212

**`Experimental`**

##### capabilities?

> `optional` **capabilities?**: `AgentEnvironmentCapabilities` \| (() => `AgentEnvironmentCapabilities` \| `Promise`\<`AgentEnvironmentCapabilities`\>)

Defined in: src/runtime/environment-provider.ts:213

**`Experimental`**

##### validateProfile?

> `optional` **validateProfile?**: (`profile`) => `AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

Defined in: src/runtime/environment-provider.ts:216

**`Experimental`**

###### Parameters

###### profile

`AgentProfileRef`

###### Returns

`AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

##### resolveProfile?

> `optional` **resolveProfile?**: (`profileId`) => `AgentProfile` \| `Promise`\<`AgentProfile`\>

Defined in: src/runtime/environment-provider.ts:220

**`Experimental`**

Resolve a named profile before calling Sandbox, which accepts inline profiles only.

###### Parameters

###### profileId

`string`

###### Returns

`AgentProfile` \| `Promise`\<`AgentProfile`\>

##### mapCreateInput?

> `optional` **mapCreateInput?**: (`input`) => `CreateSandboxOptions`

Defined in: src/runtime/environment-provider.ts:221

**`Experimental`**

###### Parameters

###### input

`CreateAgentEnvironmentInput`

###### Returns

`CreateSandboxOptions`

***

### ProviderExecutorOptions

Defined in: src/runtime/environment-provider.ts:282

**`Experimental`**

Options for running a provider as a supervise-mode executor.

#### Extended by

- [`ProviderSeam`](../runtime.md#providerseam)

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: src/runtime/environment-provider.ts:283

**`Experimental`**

##### runtime?

> `optional` **runtime?**: [`Runtime`](../runtime.md#runtime-3)

Defined in: src/runtime/environment-provider.ts:284

**`Experimental`**

##### destroyOnSettle?

> `optional` **destroyOnSettle?**: `boolean`

Defined in: src/runtime/environment-provider.ts:285

**`Experimental`**

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

Defined in: src/runtime/environment-provider.ts:286

**`Experimental`**

##### taskToTurn?

> `optional` **taskToTurn?**: (`task`, `specProfile`) => `AgentTurnInput`

Defined in: src/runtime/environment-provider.ts:287

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

Defined in: src/runtime/environment-provider.ts:92

**`Experimental`**

Provider object or registry name accepted by runtime provider adapters.

## Functions

### createAgentEnvironmentProviderRegistry()

> **createAgentEnvironmentProviderRegistry**(`providers?`): [`AgentEnvironmentProviderRegistry`](#agentenvironmentproviderregistry)

Defined in: src/runtime/environment-provider.ts:108

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

Defined in: src/runtime/environment-provider.ts:159

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

Defined in: src/runtime/environment-provider.ts:184

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

Defined in: src/runtime/environment-provider.ts:226

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

Defined in: src/runtime/environment-provider.ts:292

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
