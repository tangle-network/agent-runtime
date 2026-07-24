[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / runtime/environment-provider

# runtime/environment-provider

## Interfaces

### AgentEnvironmentProviderRegistry

Defined in: [src/runtime/environment-provider.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L95)

**`Experimental`**

In-memory registry for named `AgentEnvironmentProvider` instances.

#### Methods

##### register()

> **register**(`provider`, `options?`): `void`

Defined in: [src/runtime/environment-provider.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L96)

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

Defined in: [src/runtime/environment-provider.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L97)

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### get()

> **get**(`name`): `AgentEnvironmentProvider` \| `undefined`

Defined in: [src/runtime/environment-provider.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L98)

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`AgentEnvironmentProvider` \| `undefined`

##### require()

> **require**(`name`): `AgentEnvironmentProvider`

Defined in: [src/runtime/environment-provider.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L99)

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`AgentEnvironmentProvider`

##### names()

> **names**(): `string`[]

Defined in: [src/runtime/environment-provider.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L100)

**`Experimental`**

###### Returns

`string`[]

##### providers()

> **providers**(): `AgentEnvironmentProvider`[]

Defined in: [src/runtime/environment-provider.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L101)

**`Experimental`**

###### Returns

`AgentEnvironmentProvider`[]

##### capabilities()

> **capabilities**(`name`): `Promise`\<`AgentEnvironmentCapabilities`\>

Defined in: [src/runtime/environment-provider.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L102)

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`Promise`\<`AgentEnvironmentCapabilities`\>

***

### ProviderAsSandboxClientOptions

Defined in: [src/runtime/environment-provider.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L173)

**`Experimental`**

Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port.

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: [src/runtime/environment-provider.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L174)

**`Experimental`**

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

Defined in: [src/runtime/environment-provider.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L175)

**`Experimental`**

##### mapCreateOptions?

> `optional` **mapCreateOptions?**: (`options`) => `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: [src/runtime/environment-provider.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L176)

**`Experimental`**

###### Parameters

###### options

`CreateSandboxOptions` \| `undefined`

###### Returns

`Partial`\<`CreateAgentEnvironmentInput`\>

***

### SandboxClientProviderOptions

Defined in: [src/runtime/environment-provider.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L209)

**`Experimental`**

Options for wrapping the current Tangle sandbox client as an environment provider.

#### Properties

##### name?

> `optional` **name?**: `string`

Defined in: [src/runtime/environment-provider.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L210)

**`Experimental`**

##### defaultBackend?

> `optional` **defaultBackend?**: `BackendType`

Defined in: [src/runtime/environment-provider.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L211)

**`Experimental`**

##### capabilities?

> `optional` **capabilities?**: `AgentEnvironmentCapabilities` \| (() => `AgentEnvironmentCapabilities` \| `Promise`\<`AgentEnvironmentCapabilities`\>)

Defined in: [src/runtime/environment-provider.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L212)

**`Experimental`**

##### validateProfile?

> `optional` **validateProfile?**: (`profile`) => `AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

Defined in: [src/runtime/environment-provider.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L215)

**`Experimental`**

###### Parameters

###### profile

`AgentProfileRef`

###### Returns

`AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

##### mapCreateInput?

> `optional` **mapCreateInput?**: (`input`) => `CreateSandboxOptions`

Defined in: [src/runtime/environment-provider.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L218)

**`Experimental`**

###### Parameters

###### input

`CreateAgentEnvironmentInput`

###### Returns

`CreateSandboxOptions`

***

### ProviderExecutorOptions

Defined in: [src/runtime/environment-provider.ts:273](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L273)

**`Experimental`**

Options for running a provider as a supervise-mode executor.

#### Extended by

- [`ProviderSeam`](../runtime.md#providerseam)

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: [src/runtime/environment-provider.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L274)

**`Experimental`**

##### runtime?

> `optional` **runtime?**: [`Runtime`](../runtime.md#runtime-3)

Defined in: [src/runtime/environment-provider.ts:275](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L275)

**`Experimental`**

##### destroyOnSettle?

> `optional` **destroyOnSettle?**: `boolean`

Defined in: [src/runtime/environment-provider.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L276)

**`Experimental`**

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

Defined in: [src/runtime/environment-provider.ts:277](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L277)

**`Experimental`**

##### taskToTurn?

> `optional` **taskToTurn?**: (`task`, `specProfile`) => `AgentTurnInput`

Defined in: [src/runtime/environment-provider.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L278)

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

Defined in: [src/runtime/environment-provider.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L91)

**`Experimental`**

Provider object or registry name accepted by runtime provider adapters.

## Functions

### createAgentEnvironmentProviderRegistry()

> **createAgentEnvironmentProviderRegistry**(`providers?`): [`AgentEnvironmentProviderRegistry`](#agentenvironmentproviderregistry)

Defined in: [src/runtime/environment-provider.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L107)

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

Defined in: [src/runtime/environment-provider.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L158)

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

> **providerAsSandboxClient**(`provider`, `options?`): [`SandboxClient`](../runtime.md#sandboxclient-3)

Defined in: [src/runtime/environment-provider.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L183)

**`Experimental`**

Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths.

#### Parameters

##### provider

`AgentEnvironmentProvider`

##### options?

[`ProviderAsSandboxClientOptions`](#providerassandboxclientoptions) = `{}`

#### Returns

[`SandboxClient`](../runtime.md#sandboxclient-3)

***

### sandboxClientAsProvider()

> **sandboxClientAsProvider**(`client`, `options?`): `AgentEnvironmentProvider`

Defined in: [src/runtime/environment-provider.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L223)

**`Experimental`**

Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract.

#### Parameters

##### client

[`SandboxClient`](../runtime.md#sandboxclient-3)

##### options?

[`SandboxClientProviderOptions`](#sandboxclientprovideroptions) = `{}`

#### Returns

`AgentEnvironmentProvider`

***

### providerAsExecutor()

> **providerAsExecutor**(`provider`, `options?`): [`ExecutorFactory`](../runtime.md#executorfactory)\<`unknown`\>

Defined in: [src/runtime/environment-provider.ts:283](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L283)

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
