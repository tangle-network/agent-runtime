[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / runtime/environment-provider

# runtime/environment-provider

## Interfaces

### AgentEnvironmentProviderRegistry

Defined in: [runtime/environment-provider.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L90)

**`Experimental`**

In-memory registry for named `AgentEnvironmentProvider` instances.

#### Methods

##### register()

> **register**(`provider`, `options?`): `void`

Defined in: [runtime/environment-provider.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L91)

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

Defined in: [runtime/environment-provider.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L92)

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### get()

> **get**(`name`): `AgentEnvironmentProvider` \| `undefined`

Defined in: [runtime/environment-provider.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L93)

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`AgentEnvironmentProvider` \| `undefined`

##### require()

> **require**(`name`): `AgentEnvironmentProvider`

Defined in: [runtime/environment-provider.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L94)

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`AgentEnvironmentProvider`

##### names()

> **names**(): `string`[]

Defined in: [runtime/environment-provider.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L95)

**`Experimental`**

###### Returns

`string`[]

##### providers()

> **providers**(): `AgentEnvironmentProvider`[]

Defined in: [runtime/environment-provider.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L96)

**`Experimental`**

###### Returns

`AgentEnvironmentProvider`[]

##### capabilities()

> **capabilities**(`name`): `Promise`\<`AgentEnvironmentCapabilities`\>

Defined in: [runtime/environment-provider.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L97)

**`Experimental`**

###### Parameters

###### name

`string`

###### Returns

`Promise`\<`AgentEnvironmentCapabilities`\>

***

### ProviderAsSandboxClientOptions

Defined in: [runtime/environment-provider.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L168)

**`Experimental`**

Options for exposing an `AgentEnvironmentProvider` through the legacy sandbox client port.

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: [runtime/environment-provider.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L169)

**`Experimental`**

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

Defined in: [runtime/environment-provider.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L170)

**`Experimental`**

##### mapCreateOptions?

> `optional` **mapCreateOptions?**: (`options`) => `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: [runtime/environment-provider.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L171)

**`Experimental`**

###### Parameters

###### options

`CreateSandboxOptions` \| `undefined`

###### Returns

`Partial`\<`CreateAgentEnvironmentInput`\>

***

### SandboxClientProviderOptions

Defined in: [runtime/environment-provider.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L204)

**`Experimental`**

Options for wrapping the current Tangle sandbox client as an environment provider.

#### Properties

##### name?

> `optional` **name?**: `string`

Defined in: [runtime/environment-provider.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L205)

**`Experimental`**

##### defaultBackend?

> `optional` **defaultBackend?**: `BackendType`

Defined in: [runtime/environment-provider.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L206)

**`Experimental`**

##### capabilities?

> `optional` **capabilities?**: `AgentEnvironmentCapabilities` \| (() => `AgentEnvironmentCapabilities` \| `Promise`\<`AgentEnvironmentCapabilities`\>)

Defined in: [runtime/environment-provider.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L207)

**`Experimental`**

##### validateProfile?

> `optional` **validateProfile?**: (`profile`) => `AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

Defined in: [runtime/environment-provider.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L210)

**`Experimental`**

###### Parameters

###### profile

`AgentProfileRef`

###### Returns

`AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

##### mapCreateInput?

> `optional` **mapCreateInput?**: (`input`) => `CreateSandboxOptions`

Defined in: [runtime/environment-provider.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L213)

**`Experimental`**

###### Parameters

###### input

`CreateAgentEnvironmentInput`

###### Returns

`CreateSandboxOptions`

***

### ProviderExecutorOptions

Defined in: [runtime/environment-provider.ts:268](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L268)

**`Experimental`**

Options for running a provider as a supervise-mode executor.

#### Extended by

- [`ProviderSeam`](../runtime.md#providerseam)

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: [runtime/environment-provider.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L269)

**`Experimental`**

##### runtime?

> `optional` **runtime?**: `Runtime`

Defined in: [runtime/environment-provider.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L270)

**`Experimental`**

##### destroyOnSettle?

> `optional` **destroyOnSettle?**: `boolean`

Defined in: [runtime/environment-provider.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L271)

**`Experimental`**

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

Defined in: [runtime/environment-provider.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L272)

**`Experimental`**

##### taskToTurn?

> `optional` **taskToTurn?**: (`task`, `specProfile`) => `AgentTurnInput`

Defined in: [runtime/environment-provider.ts:273](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L273)

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

Defined in: [runtime/environment-provider.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L86)

**`Experimental`**

Provider object or registry name accepted by runtime provider adapters.

## Functions

### createAgentEnvironmentProviderRegistry()

> **createAgentEnvironmentProviderRegistry**(`providers?`): [`AgentEnvironmentProviderRegistry`](#agentenvironmentproviderregistry)

Defined in: [runtime/environment-provider.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L102)

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

Defined in: [runtime/environment-provider.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L153)

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

> **providerAsSandboxClient**(`provider`, `options?`): [`SandboxClient`](../runtime.md#sandboxclient-1)

Defined in: [runtime/environment-provider.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L178)

**`Experimental`**

Adapt a neutral environment provider to the `SandboxClient` interface used by existing loop paths.

#### Parameters

##### provider

`AgentEnvironmentProvider`

##### options?

[`ProviderAsSandboxClientOptions`](#providerassandboxclientoptions) = `{}`

#### Returns

[`SandboxClient`](../runtime.md#sandboxclient-1)

***

### sandboxClientAsProvider()

> **sandboxClientAsProvider**(`client`, `options?`): `AgentEnvironmentProvider`

Defined in: [runtime/environment-provider.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L218)

**`Experimental`**

Adapt a `SandboxClient` into the shared `AgentEnvironmentProvider` contract.

#### Parameters

##### client

[`SandboxClient`](../runtime.md#sandboxclient-1)

##### options?

[`SandboxClientProviderOptions`](#sandboxclientprovideroptions) = `{}`

#### Returns

`AgentEnvironmentProvider`

***

### providerAsExecutor()

> **providerAsExecutor**(`provider`, `options?`): `ExecutorFactory`\<`unknown`\>

Defined in: [runtime/environment-provider.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L278)

**`Experimental`**

Adapt an environment provider into an `ExecutorFactory` for `createExecutor`.

#### Parameters

##### provider

`AgentEnvironmentProvider`

##### options?

[`ProviderExecutorOptions`](#providerexecutoroptions) = `{}`

#### Returns

`ExecutorFactory`\<`unknown`\>
