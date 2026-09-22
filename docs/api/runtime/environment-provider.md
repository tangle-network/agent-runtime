[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / runtime/environment-provider

# runtime/environment-provider

## Interfaces

### AgentEnvironmentProviderRegistry

**`Experimental`**

In-memory registry for named agent environment provider instances.

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

Options for exposing an environment provider through the legacy Sandbox client port.

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

## Type Aliases

### ResolveSandboxProfile

> **ResolveSandboxProfile** = (`profileId`) => `AgentProfile` \| `Promise`\<`AgentProfile`\>

Resolve a named profile before passing it to Sandbox, which accepts inline profiles only.

#### Parameters

##### profileId

`string`

#### Returns

`AgentProfile` \| `Promise`\<`AgentProfile`\>

***

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

Adapt an environment provider to the Sandbox client shape used by existing loop paths.

#### Parameters

##### provider

`AgentEnvironmentProvider`

##### options?

[`ProviderAsSandboxClientOptions`](#providerassandboxclientoptions) = `{}`

#### Returns

[`SandboxClient`](../runtime.md#sandboxclient-5)

## References

### SandboxClientProviderOptions

Re-exports [SandboxClientProviderOptions](../runtime.md#sandboxclientprovideroptions)

***

### sandboxClientAsProvider

Re-exports [sandboxClientAsProvider](../runtime.md#sandboxclientasprovider)

***

### CreateTangleSandboxExactProcessProviderOptions

Re-exports [CreateTangleSandboxExactProcessProviderOptions](../runtime.md#createtanglesandboxexactprocessprovideroptions)

***

### createTangleSandboxExactProcessProvider

Re-exports [createTangleSandboxExactProcessProvider](../runtime.md#createtanglesandboxexactprocessprovider)

***

### ProviderExecutorOptions

Re-exports [ProviderExecutorOptions](../runtime.md#providerexecutoroptions)

***

### providerAsExecutor

Re-exports [providerAsExecutor](../runtime.md#providerasexecutor)
