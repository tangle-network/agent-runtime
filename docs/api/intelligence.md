[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / intelligence

# intelligence

## Classes

### CapabilityNotAdmittedError

Defined in: [intelligence/capability.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L246)

A binding kind whose resolver case is typed but not yet admitted (rag-index,
memory-store, wasm, a2a). Thrown by the resolver — NEVER faked into a working
surface. The TYPE arms exist so the union is closed against the spec; the
resolver grows them later behind their lifecycle + admission gate.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CapabilityNotAdmittedError**(`kind`, `capabilityId`, `reason`): [`CapabilityNotAdmittedError`](#capabilitynotadmittederror)

Defined in: [intelligence/capability.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L249)

###### Parameters

###### kind

`"inline"` \| `"file"` \| `"http"` \| `"sandbox-code"` \| `"mcp-stdio"` \| `"mcp-remote"` \| `"process-on-infra"` \| `"rag-index"` \| `"memory-store"` \| `"wasm"` \| `"a2a"`

###### capabilityId

`string`

###### reason

`string`

###### Returns

[`CapabilityNotAdmittedError`](#capabilitynotadmittederror)

###### Overrides

`Error.constructor`

#### Properties

##### kind

> `readonly` **kind**: `"inline"` \| `"file"` \| `"http"` \| `"sandbox-code"` \| `"mcp-stdio"` \| `"mcp-remote"` \| `"process-on-infra"` \| `"rag-index"` \| `"memory-store"` \| `"wasm"` \| `"a2a"`

Defined in: [intelligence/capability.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L247)

##### capabilityId

> `readonly` **capabilityId**: `string`

Defined in: [intelligence/capability.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L248)

## Interfaces

### CredentialRef

Defined in: [intelligence/capability.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L72)

A named secret a binding requires — declared, never carried.

#### Properties

##### key

> **key**: `string`

Defined in: [intelligence/capability.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L73)

***

### HostSpec

Defined in: [intelligence/capability.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L95)

The host a `process-on-infra` binding provisions before its inner binding.
Reuses `createExecutor`'s backend-as-data vocabulary — no new runtime invented.
`image` is the sandbox image tag; `warm`/`idleTtlMs`/`costTag` meter standing
cost; `ports` are the inner server's listen ports the host must expose.

#### Properties

##### backend

> **backend**: `"router"` \| `"sandbox"` \| `"cli"`

Defined in: [intelligence/capability.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L96)

##### image?

> `optional` **image?**: `string`

Defined in: [intelligence/capability.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L97)

##### ports?

> `optional` **ports?**: `number`[]

Defined in: [intelligence/capability.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L98)

##### warm?

> `optional` **warm?**: `boolean`

Defined in: [intelligence/capability.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L99)

##### idleTtlMs?

> `optional` **idleTtlMs?**: `number`

Defined in: [intelligence/capability.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L100)

##### costTag?

> `optional` **costTag?**: `string`

Defined in: [intelligence/capability.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L101)

***

### CertProvenance

Defined in: [intelligence/capability.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L155)

The certify lane's held-out lift travelling WITH delivery. The shipped
`CertifiedArtifact` envelope minus its content (which moves into the binding
arm): `version`/`contentHash`/`lift` are stamped by the promote step, never
the author.

`sourcePath` is the artifact's ORIGINAL path (including `null`). It is the
byte-stable fold sort key — the resolver folds context artifacts in
`composeCertifiedPrompt` order, which sorts by `path ?? ''`, so a `null` path
is load-bearing and MUST round-trip exactly. It is distinct from a context
`iface.name` (display only): collapsing the two flips the fold order for a
mix of null-path and non-null-path artifacts.

#### Properties

##### contentHash

> **contentHash**: `string`

Defined in: [intelligence/capability.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L156)

##### version

> **version**: `number` \| `null`

Defined in: [intelligence/capability.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L157)

##### lift

> **lift**: `string` \| `null`

Defined in: [intelligence/capability.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L158)

##### promotedAt

> **promotedAt**: `string`

Defined in: [intelligence/capability.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L159)

##### sourcePath

> **sourcePath**: `string` \| `null`

Defined in: [intelligence/capability.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L160)

***

### CertifiedCapability

Defined in: [intelligence/capability.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L164)

One certified unit of agent power.

#### Properties

##### id

> **id**: `string`

Defined in: [intelligence/capability.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L165)

##### iface

> **iface**: [`CapabilityInterface`](#capabilityinterface)

Defined in: [intelligence/capability.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L166)

##### binding

> **binding**: [`DeliveryBinding`](#deliverybinding)

Defined in: [intelligence/capability.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L167)

##### auth

> **auth**: [`CapabilityAuth`](#capabilityauth)

Defined in: [intelligence/capability.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L168)

##### provenance

> **provenance**: [`CertProvenance`](#certprovenance)

Defined in: [intelligence/capability.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L169)

***

### CapabilityManifest

Defined in: [intelligence/capability.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L177)

The strict generalization of `CertifiedProfile`. `promptSurface` is kept
during the migration window (the shipped pull lane still emits it); new
capabilities live in `capabilities`.

#### Properties

##### target

> **target**: `string`

Defined in: [intelligence/capability.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L178)

##### generatedAt

> **generatedAt**: `string`

Defined in: [intelligence/capability.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L179)

##### promptSurface

> **promptSurface**: [`CertifiedPromptSurface`](#certifiedpromptsurface) \| `null`

Defined in: [intelligence/capability.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L180)

##### capabilities

> **capabilities**: [`CertifiedCapability`](#certifiedcapability)[]

Defined in: [intelligence/capability.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L181)

***

### ResolvedRetrieval

Defined in: [intelligence/capability.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L187)

One retrieval handle. The agent never learns vector vs graph vs index.

#### Properties

##### name

> **name**: `string`

Defined in: [intelligence/capability.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L188)

#### Methods

##### retrieve()

> **retrieve**(`query`, `k?`): `Promise`\<`object`[]\>

Defined in: [intelligence/capability.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L189)

###### Parameters

###### query

`string`

###### k?

`number`

###### Returns

`Promise`\<`object`[]\>

***

### ResolvedHook

Defined in: [intelligence/capability.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L194)

One resolved hook — event + the command/matcher the seam folds into
 `AgentProfile.hooks`.

#### Properties

##### event

> **event**: `string`

Defined in: [intelligence/capability.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L195)

##### command

> **command**: `string`

Defined in: [intelligence/capability.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L196)

##### matcher?

> `optional` **matcher?**: `string`

Defined in: [intelligence/capability.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L197)

***

### ResolvedSubagent

Defined in: [intelligence/capability.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L201)

One resolved subagent — folded into `AgentProfile.subagents`.

#### Properties

##### name

> **name**: `string`

Defined in: [intelligence/capability.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L202)

##### description?

> `optional` **description?**: `string`

Defined in: [intelligence/capability.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L203)

##### prompt?

> `optional` **prompt?**: `string`

Defined in: [intelligence/capability.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L204)

***

### ResolvedSurface

Defined in: [intelligence/capability.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L213)

What `composeCertifiedProfile` produces. Every binding fans into the same
slots, consumed identically by the in-process seam (`RouterToolsSeam.{tools,
executeToolCall}` + folded prompt) and the sandbox seam (`AgentProfile`).
`dispose()` tears provisioned hosts down in REVERSE dependency order.

#### Properties

##### tools

> **tools**: [`ToolSpec`](runtime.md#toolspec)[]

Defined in: [intelligence/capability.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L215)

Host-side tool defs → `RouterToolsSeam.tools` / agent-app `extraTools`.

##### mcpConnections

> **mcpConnections**: `Record`\<`string`, `AgentProfileMcpServer`\>

Defined in: [intelligence/capability.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L220)

Sandbox-side tool delivery → `AgentProfile.mcp` / in-proc `createMcpEnvironment`.

##### promptAdditions

> **promptAdditions**: `string`[]

Defined in: [intelligence/capability.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L222)

Prompt-context additions, byte-stable-ordered → folded system prompt.

##### files

> **files**: `object`[]

Defined in: [intelligence/capability.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L224)

Workspace files → `AgentProfile.resources.files`.

###### path

> **path**: `string`

###### content

> **content**: `string`

###### executable?

> `optional` **executable?**: `boolean`

##### retrieval

> **retrieval**: [`ResolvedRetrieval`](#resolvedretrieval)[]

Defined in: [intelligence/capability.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L226)

Uniform retrieval handles.

##### hooks

> **hooks**: [`ResolvedHook`](#resolvedhook)[]

Defined in: [intelligence/capability.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L228)

Hooks → `AgentProfile.hooks`.

##### subagents

> **subagents**: [`ResolvedSubagent`](#resolvedsubagent)[]

Defined in: [intelligence/capability.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L230)

Subagents → `AgentProfile.subagents`.

##### systemPrompt

> **systemPrompt**: `string`

Defined in: [intelligence/capability.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L233)

The folded system prompt — base + the byte-stable prompt additions, exactly
 as `composeCertifiedPrompt` renders the inline/context capabilities.

#### Methods

##### execute()

> **execute**(`name`, `args`, `task`): `Promise`\<`string`\>

Defined in: [intelligence/capability.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L218)

Host-side dispatch for a resolved tool. Throws when `name` is unknown so a
 mis-dispatch is loud, never a silent empty string.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### task

`unknown`

###### Returns

`Promise`\<`string`\>

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Defined in: [intelligence/capability.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L235)

Tear down provisioned hosts (reverse dependency order).

###### Returns

`Promise`\<`void`\>

***

### CertifiedArtifact

Defined in: [intelligence/delivery.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L34)

A promoted, certified artifact (one entry in the composed profile).

#### Properties

##### path

> **path**: `string` \| `null`

Defined in: [intelligence/delivery.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L35)

##### content

> **content**: `string`

Defined in: [intelligence/delivery.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L36)

##### contentHash

> **contentHash**: `string`

Defined in: [intelligence/delivery.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L37)

##### version

> **version**: `number` \| `null`

Defined in: [intelligence/delivery.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L38)

##### lift

> **lift**: `string` \| `null`

Defined in: [intelligence/delivery.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L41)

Held-out gate lift attached at certification, e.g. "+3.1pp" — never a
 within-run claim. `null` when the promotion carried no lift record.

##### promotedAt

> **promotedAt**: `string`

Defined in: [intelligence/delivery.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L42)

***

### CertifiedPromptSurface

Defined in: [intelligence/delivery.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L46)

The active promoted prompt surface for a target.

#### Properties

##### surface

> **surface**: `string`

Defined in: [intelligence/delivery.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L47)

##### surfaceHash

> **surfaceHash**: `string`

Defined in: [intelligence/delivery.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L48)

##### version

> **version**: `number` \| `null`

Defined in: [intelligence/delivery.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L49)

##### lift

> **lift**: `string` \| `null`

Defined in: [intelligence/delivery.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L50)

***

### CertifiedProfile

Defined in: [intelligence/delivery.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L55)

The composed certified profile — exactly the shape the plane's
 `GET /v1/profiles/:target/composed` returns.

#### Properties

##### target

> **target**: `string`

Defined in: [intelligence/delivery.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L56)

##### generatedAt

> **generatedAt**: `string`

Defined in: [intelligence/delivery.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L57)

##### promptSurface

> **promptSurface**: [`CertifiedPromptSurface`](#certifiedpromptsurface) \| `null`

Defined in: [intelligence/delivery.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L58)

##### artifacts

> **artifacts**: `Record`\<`string`, [`CertifiedArtifact`](#certifiedartifact)[]\>

Defined in: [intelligence/delivery.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L59)

***

### PullCertifiedOptions

Defined in: [intelligence/delivery.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L68)

#### Extended by

- [`CertifiedPromptSourceOptions`](#certifiedpromptsourceoptions)

#### Properties

##### target

> **target**: `string`

Defined in: [intelligence/delivery.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L70)

The agent target certified artifacts are promoted under.

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/delivery.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L72)

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [intelligence/delivery.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L75)

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/delivery.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L77)

fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [intelligence/delivery.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L81)

Abort the pull after this many ms so a hung plane never blocks the caller.
 Default 10000. The timeout surfaces as a normal fail-closed `succeeded:
 false` (the agent runs on its base surface).

***

### CertifiedPromptSource

Defined in: [intelligence/delivery.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L187)

A cached, self-refreshing source of a target's certified prompt additions —
 the prompt-only delivery lane for callers that assemble their OWN system
 prompt (product chat routes) rather than wrapping an agent fn. Same
 fail-closed semantics as [withCertifiedDelivery](#withcertifieddelivery): pulls at most every
 `refreshMs`, coalesces concurrent pulls, keeps the last-known profile on a
 failed/404 pull, never throws, never blocks past the pull timeout.

#### Methods

##### compose()

> **compose**(`base`): `Promise`\<`string`\>

Defined in: [intelligence/delivery.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L190)

Refresh (window-respecting) then fold the certified additions into a
 base system prompt. Returns `base` unchanged when nothing is promoted.

###### Parameters

###### base

`string`

###### Returns

`Promise`\<`string`\>

##### current()

> **current**(): [`CertifiedProfile`](#certifiedprofile) \| `null`

Defined in: [intelligence/delivery.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L192)

The certified profile currently in effect (`null` = none pulled yet).

###### Returns

[`CertifiedProfile`](#certifiedprofile) \| `null`

##### refresh()

> **refresh**(): `Promise`\<`void`\>

Defined in: [intelligence/delivery.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L194)

Pull now if the refresh window has elapsed; coalesced and fail-closed.

###### Returns

`Promise`\<`void`\>

***

### CertifiedPromptSourceOptions

Defined in: [intelligence/delivery.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L199)

Options for [createCertifiedPromptSource](#createcertifiedpromptsource) — the pull coordinates plus
 the refresh cadence.

#### Extends

- [`PullCertifiedOptions`](#pullcertifiedoptions)

#### Properties

##### target

> **target**: `string`

Defined in: [intelligence/delivery.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L70)

The agent target certified artifacts are promoted under.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`target`](#target-2)

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/delivery.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L72)

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`apiKey`](#apikey)

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [intelligence/delivery.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L75)

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`baseUrl`](#baseurl)

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/delivery.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L77)

fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`fetchImpl`](#fetchimpl)

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [intelligence/delivery.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L81)

Abort the pull after this many ms so a hung plane never blocks the caller.
 Default 10000. The timeout surfaces as a normal fail-closed `succeeded:
 false` (the agent runs on its base surface).

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`timeoutMs`](#timeoutms)

##### refreshMs?

> `optional` **refreshMs?**: `number`

Defined in: [intelligence/delivery.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L201)

Min interval between certified-profile pulls. Default 5m.

***

### AppliedIntelligence

Defined in: [intelligence/delivery.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L246)

What the delivery wrapper hands the agent each run.

#### Properties

##### certified

> **certified**: [`CertifiedProfile`](#certifiedprofile) \| `null`

Defined in: [intelligence/delivery.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L249)

The certified profile in effect (null when none promoted / pull failed —
 fail-closed: the agent runs on its base surface).

#### Methods

##### composePrompt()

> **composePrompt**(`base`): `string`

Defined in: [intelligence/delivery.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L251)

Fold the certified prompt surface into a base system prompt.

###### Parameters

###### base

`string`

###### Returns

`string`

***

### DeliveryConfig

Defined in: [intelligence/delivery.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L259)

Delivery config = the Observe config plus the pull target + refresh cadence.

#### Extends

- [`IntelligenceConfig`](#intelligenceconfig)

#### Properties

##### target?

> `optional` **target?**: `string`

Defined in: [intelligence/delivery.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L261)

Pull target. Defaults to `project`.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [intelligence/delivery.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L264)

Plane base URL for the pull (NOT the OTLP `endpoint`). Defaults to
 `TANGLE_INTELLIGENCE_URL` then `https://intelligence.tangle.tools`.

##### refreshMs?

> `optional` **refreshMs?**: `number`

Defined in: [intelligence/delivery.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L266)

Min interval between certified-profile pulls. Default 5m.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [intelligence/delivery.ts:268](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L268)

Per-pull timeout in ms (fail-closed on a hung plane). Default 10000.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/delivery.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L270)

fetch impl for the pull (tests). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### project

> **project**: `string`

Defined in: [intelligence/index.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L132)

Stable project id — the tenant dimension every trace is tagged with.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`project`](#project-1)

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/index.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L134)

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`apiKey`](#apikey-3)

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Defined in: [intelligence/index.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L136)

Effort tier (default `'standard'`) plus optional per-field overrides.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`effort`](#effort-1)

##### endpoint?

> `optional` **endpoint?**: `string`

Defined in: [intelligence/index.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L143)

OTLP ingest base. The underlying exporter appends `/v1/traces`, so point
this at the OTLP route (e.g. `https://intelligence.tangle.tools/v1/otlp`).
Reads `INTELLIGENCE_OTLP_ENDPOINT` then `OTEL_EXPORTER_OTLP_ENDPOINT` when
omitted; absent all three, export is a no-op (best-effort by construction).

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`endpoint`](#endpoint-1)

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Defined in: [intelligence/index.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L149)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`redact`](#redact-1)

##### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: [intelligence/index.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L151)

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`surfaces`](#surfaces-1)

##### checks?

> `optional` **checks?**: `string`[]

Defined in: [intelligence/index.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L153)

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`checks`](#checks-1)

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Defined in: [intelligence/index.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L155)

Repo access a later PR mode would need. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`repo`](#repo-1)

***

### EffortSettings

Defined in: [intelligence/effort.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L32)

The flat, resolved settings a tier compiles to. Every field is individually
overridable through `resolveEffort`. Pure data — read by the wrapper, never
self-executing.

#### Properties

##### analysts

> **analysts**: `boolean`

Defined in: [intelligence/effort.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L34)

Whether trace-derived analyst diagnosis may spawn. `false` ⇒ no analyst.

##### corpus

> **corpus**: [`CorpusAccess`](#corpusaccess)

Defined in: [intelligence/effort.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L36)

Cross-run corpus access this tier permits.

##### fanout

> **fanout**: `number`

Defined in: [intelligence/effort.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L38)

Parallel candidate width. `1` ⇒ single-shot, no breadth.

##### loops

> **loops**: `boolean`

Defined in: [intelligence/effort.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L40)

Whether multi-step improvement loops (refine / fanout-vote) may run.

##### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Defined in: [intelligence/effort.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L47)

Ceiling, in USD, for INTELLIGENCE-class spawns only (analysts, corpus,
loops) — NOT base inference. `0` refuses every intelligence spawn; `null`
means uncapped (the spend lands on the Pareto receipt). Base-stream
inference is billed on its own channel and is never constrained here.

***

### EffortOverridesCompiled

Defined in: [intelligence/effort.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L157)

The run-config overrides an `EffortSettings` compiles to — the bridge between the
pure effort policy and the orchestration entrypoints (`runPersonified` / the
improvement cycle). This is ONLY data: it never constructs an analyst or runs a
loop. The caller reads these flags to decide WHAT to pass:

 - `withAnalyst: false` ⇒ DO NOT construct/pass a `ScopeAnalyst` to `runPersonified`
   (the dormant empty-findings path runs; the base agent still works). This is the
   PRODUCT fail-closed at `off`/`eco` — "don't construct the analyst" — distinct from
   the EXPERIMENT fail-closed inside `createScopeAnalyst` ("hard abort"), which stays
   untouched. Degrade, never throw.
 - `fanout` ⇒ the `ShapeBudget.fanout` width to pass (`1` at `off`, the tier's breadth
   otherwise). Overrides the personify default fanout.
 - `withLoops: false` ⇒ the improvement cycle is a no-op for this run (no refine /
   fanout-vote multi-step loop spawns).
 - `intelligenceBudgetUsd` ⇒ the intelligence-class spend ceiling carried through for
   the billing clamp (passed verbatim; `0` refuses every intelligence spawn).

#### Properties

##### withAnalyst

> **withAnalyst**: `boolean`

Defined in: [intelligence/effort.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L159)

Construct + pass a `ScopeAnalyst`? `false` ⇒ omit it (degrade to the base agent).

##### fanout

> **fanout**: `number`

Defined in: [intelligence/effort.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L161)

`ShapeBudget.fanout` width to pass to `runPersonified`.

##### withLoops

> **withLoops**: `boolean`

Defined in: [intelligence/effort.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L163)

Run the multi-step improvement cycle, or no-op it for this run?

##### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Defined in: [intelligence/effort.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L165)

Intelligence-class spend ceiling. `0` refuses every intelligence spawn; `null` uncapped.

***

### UsageSplit

Defined in: [intelligence/index.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L111)

The per-class cost split carried by every trace and outcome. `off` ⇒
`intelligenceUsd: 0` by construction — there is no intelligence spawn to
bill. This is a classification on the trace, NOT a budget-pool split.

#### Properties

##### inferenceUsd

> **inferenceUsd**: `number`

Defined in: [intelligence/index.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L113)

Base-stream (model) spend in USD.

##### intelligenceUsd

> **intelligenceUsd**: `number`

Defined in: [intelligence/index.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L115)

Intelligence-spawn spend in USD. Provably `0` at the OFF tier.

***

### RepoConfig

Defined in: [intelligence/index.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L121)

Repo coordinates a product may declare for the (later) Gated-PR mode. The
 Observe slice only records their PRESENCE for `doctor()`; it never touches
 the repo.

#### Properties

##### owner

> **owner**: `string`

Defined in: [intelligence/index.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L122)

##### name

> **name**: `string`

Defined in: [intelligence/index.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L123)

##### baseBranch

> **baseBranch**: `string`

Defined in: [intelligence/index.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L124)

***

### IntelligenceConfig

Defined in: [intelligence/index.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L130)

Client configuration. `project` + `apiKey` are the Observe minimum; the
 rest tune effort, endpoint, redaction, and (for `doctor()` readiness)
 declare the surfaces/checks/repo a later PR mode would need.

#### Extended by

- [`DeliveryConfig`](#deliveryconfig)

#### Properties

##### project

> **project**: `string`

Defined in: [intelligence/index.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L132)

Stable project id — the tenant dimension every trace is tagged with.

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/index.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L134)

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Defined in: [intelligence/index.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L136)

Effort tier (default `'standard'`) plus optional per-field overrides.

##### endpoint?

> `optional` **endpoint?**: `string`

Defined in: [intelligence/index.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L143)

OTLP ingest base. The underlying exporter appends `/v1/traces`, so point
this at the OTLP route (e.g. `https://intelligence.tangle.tools/v1/otlp`).
Reads `INTELLIGENCE_OTLP_ENDPOINT` then `OTEL_EXPORTER_OTLP_ENDPOINT` when
omitted; absent all three, export is a no-op (best-effort by construction).

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Defined in: [intelligence/index.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L149)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

##### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: [intelligence/index.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L151)

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

##### checks?

> `optional` **checks?**: `string`[]

Defined in: [intelligence/index.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L153)

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Defined in: [intelligence/index.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L155)

Repo access a later PR mode would need. Recorded for `doctor()` only.

***

### TraceMeta

Defined in: [intelligence/index.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L159)

Metadata describing one traced run. `runId`/`traceId` default to fresh ids.

#### Properties

##### input?

> `optional` **input?**: `unknown`

Defined in: [intelligence/index.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L161)

The run's input — exported through the redactor.

##### runId?

> `optional` **runId?**: `string`

Defined in: [intelligence/index.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L163)

Stable run id. Defaults to a fresh id.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [intelligence/index.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L165)

32-hex trace id. Defaults to a fresh id.

##### model?

> `optional` **model?**: `string`

Defined in: [intelligence/index.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L167)

Model id, when known — stamped on the span.

##### provider?

> `optional` **provider?**: `string`

Defined in: [intelligence/index.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L169)

Provider name, when known — stamped on the span.

##### labels?

> `optional` **labels?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [intelligence/index.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L171)

Arbitrary extra labels (string/number/boolean) stamped on the span.

***

### TraceHandle

Defined in: [intelligence/index.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L180)

The trace handle a `traceRun` body records into. `recordOutput` captures the
agent's result (redacted on export); `recordOutcome` captures the scored
outcome + the `{ inferenceUsd, intelligenceUsd }` split. Both are optional —
an un-recorded run still exports a span with whatever was set.

#### Methods

##### recordOutput()

> **recordOutput**(`output`): `void`

Defined in: [intelligence/index.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L182)

Capture the run's output. Exported through the redactor.

###### Parameters

###### output

`unknown`

###### Returns

`void`

##### recordOutcome()

> **recordOutcome**(`outcome`): `void`

Defined in: [intelligence/index.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L189)

Capture the run's outcome. `usage` defaults to inference-only
(`intelligenceUsd: 0`) — the OFF baseline; an intelligence-enabled run
fills `intelligenceUsd` itself. `costUsd`, when given without a split, is
treated as pure inference.

###### Parameters

###### outcome

###### success?

`boolean`

###### score?

`number`

###### costUsd?

`number`

###### usage?

`Partial`\<[`UsageSplit`](#usagesplit)\>

###### Returns

`void`

***

### RecordTraceMeta

Defined in: [intelligence/index.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L198)

Metadata for [IntelligenceClient.recordTrace](#recordtrace).

#### Properties

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [intelligence/index.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L200)

32-hex trace id to anchor every span to. Defaults to a fresh id.

##### rootParentSpanId?

> `optional` **rootParentSpanId?**: `string`

Defined in: [intelligence/index.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L203)

Span id of an enclosing span the loop root should parent under (e.g. a
 `traceRun` span). Omitted ⇒ the loop root is the trace root.

***

### TraceOutcome

Defined in: [intelligence/index.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L208)

The resolved outcome of one traced run, surfaced on the export span and
 available to the caller for downstream billing assertions.

#### Properties

##### runId

> **runId**: `string`

Defined in: [intelligence/index.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L209)

##### traceId

> **traceId**: `string`

Defined in: [intelligence/index.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L210)

##### project

> **project**: `string`

Defined in: [intelligence/index.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L211)

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

Defined in: [intelligence/index.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L213)

The resolved effort settings this run executed under.

##### intelligenceOff

> **intelligenceOff**: `boolean`

Defined in: [intelligence/index.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L215)

True when this run ran as pure passthrough (the OFF floor).

##### success?

> `optional` **success?**: `boolean`

Defined in: [intelligence/index.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L216)

##### score?

> `optional` **score?**: `number`

Defined in: [intelligence/index.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L217)

##### usage

> **usage**: [`UsageSplit`](#usagesplit)

Defined in: [intelligence/index.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L219)

Per-class billing split. `intelligenceUsd` is `0` at the OFF tier.

***

### IntelligenceClient

Defined in: [intelligence/index.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L223)

The Observe-mode Intelligence client.

#### Properties

##### project

> `readonly` **project**: `string`

Defined in: [intelligence/index.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L225)

The resolved project id.

##### effort

> `readonly` **effort**: [`EffortSettings`](#effortsettings)

Defined in: [intelligence/index.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L227)

The resolved effort settings.

#### Methods

##### traceRun()

> **traceRun**\<`T`\>(`meta`, `fn`): `Promise`\<`T`\>

Defined in: [intelligence/index.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L233)

Run `fn` under a trace, export one span best-effort, and return whatever
`fn` returns. Telemetry-export failures are swallowed; an error THROWN by
`fn` propagates to the caller (the agent's own failures are not masked).

###### Type Parameters

###### T

`T`

###### Parameters

###### meta

[`TraceMeta`](#tracemeta)

###### fn

(`trace`) => `Promise`\<`T`\>

###### Returns

`Promise`\<`T`\>

##### recordTrace()

> **recordTrace**(`events`, `meta?`): `string`

Defined in: [intelligence/index.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L243)

Export a run's full loop topology — the ordered `LoopTraceEvent` stream a
`runLoop`/`Supervisor` run emits — as a nested OTLP span tree (loop → round →
iteration) into ONE trace. Reuses the shipped `buildLoopOtelSpans` builder
(NO second span builder), so the topology a viewer renders matches the
kernel's. `traceId` defaults to a fresh id; `rootParentSpanId` parents the
loop root under an enclosing span (e.g. a `traceRun` span) when given.
Best-effort: export failures are swallowed. Returns the resolved `traceId`.

###### Parameters

###### events

readonly [`LoopTraceEvent`](runtime.md#looptraceevent)[]

###### meta?

[`RecordTraceMeta`](#recordtracemeta)

###### Returns

`string`

##### doctor()

> **doctor**(): [`DoctorReport`](#doctorreport)

Defined in: [intelligence/index.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L249)

Network-free readiness report: which adoption modes are reachable given
this config. Observe is always reachable; Recommend needs outcomes; PR
needs checks + surfaces + repo.

###### Returns

[`DoctorReport`](#doctorreport)

##### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [intelligence/index.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L251)

Flush any pending export spans. Best-effort; resolves even if export fails.

###### Returns

`Promise`\<`void`\>

***

### ModeReadiness

Defined in: [intelligence/index.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L255)

One mode's readiness verdict.

#### Properties

##### ready

> **ready**: `boolean`

Defined in: [intelligence/index.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L256)

##### missing

> **missing**: `string`[]

Defined in: [intelligence/index.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L258)

Inputs this mode still needs, when not ready. Empty when ready.

***

### DoctorReport

Defined in: [intelligence/index.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L262)

The `doctor()` readiness report — Mode-readiness without any network call.

#### Properties

##### project

> **project**: `string`

Defined in: [intelligence/index.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L263)

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

Defined in: [intelligence/index.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L264)

##### exportConfigured

> **exportConfigured**: `boolean`

Defined in: [intelligence/index.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L266)

True when an OTLP endpoint is configured (export will actually ship).

##### modes

> **modes**: `object`

Defined in: [intelligence/index.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L267)

###### observe

> **observe**: [`ModeReadiness`](#modereadiness)

###### recommend

> **recommend**: [`ModeReadiness`](#modereadiness)

###### pr

> **pr**: [`ModeReadiness`](#modereadiness)

***

### ProvisionedHost

Defined in: [intelligence/resolver.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L50)

A live, provisioned host the resolver tore up for a `process-on-infra` arm.
 `teardown()` runs at `dispose()` in reverse provisioning order.

#### Properties

##### mcpConnection?

> `optional` **mcpConnection?**: `AgentProfileMcpServer`

Defined in: [intelligence/resolver.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L53)

Lower the inner binding's mcp connection now that the host is up; the URL/
 command points at the host. Absent when the host serves a non-mcp inner.

#### Methods

##### teardown()

> **teardown**(): `Promise`\<`void`\>

Defined in: [intelligence/resolver.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L54)

###### Returns

`Promise`\<`void`\>

***

### ResolveCtx

Defined in: [intelligence/resolver.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L62)

Per-call, per-tenant context the resolver reads. Everything that touches the
network, a secret, or an infra provisioner is INJECTED so the manifest carries
no live secret and the substrate-free caller wires only what it can host.

#### Properties

##### tenant?

> `optional` **tenant?**: `string`

Defined in: [intelligence/resolver.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L64)

Stable tenant id — namespaces billing + teardown (`tenant#target`).

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/resolver.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L66)

fetch impl for http tools. Defaults to global fetch; absent ⇒ http tools fail loud.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### resolveSecret?

> `optional` **resolveSecret?**: (`auth`, `tenant`) => `Promise`\<\{ `succeeded`: `true`; `value`: `string`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Defined in: [intelligence/resolver.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L72)

Resolve a declared credential to a live secret for THIS tenant. Returns a
typed outcome — inspect `succeeded` before `value`. Absent ⇒ a binding that
declares non-`none` auth fails loud (never a request with no credential).

###### Parameters

###### auth

[`CapabilityAuth`](#capabilityauth)

###### tenant

`string` \| `undefined`

###### Returns

`Promise`\<\{ `succeeded`: `true`; `value`: `string`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

##### runSandboxCode?

> `optional` **runSandboxCode?**: (`code`, `entry`, `args`, `task`) => `Promise`\<`string`\>

Defined in: [intelligence/resolver.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L81)

Run a `sandbox-code` body per call. Injected by the host that owns a sandbox
client (the spine does not import the sandbox executor). Absent ⇒
`sandbox-code` bindings fail loud.

###### Parameters

###### code

[`ContentRef`](#contentref)

###### entry

`string`

###### args

`Record`\<`string`, `unknown`\>

###### task

`unknown`

###### Returns

`Promise`\<`string`\>

##### provisionHost?

> `optional` **provisionHost?**: (`host`, `inner`, `costTag`) => `Promise`\<[`ProvisionedHost`](#provisionedhost)\>

Defined in: [intelligence/resolver.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L93)

Provision a host for a `process-on-infra` binding, then serve the inner
binding inside it. Injected by the host that owns `createExecutor`. Absent ⇒
`process-on-infra` bindings fail loud. The provider resolves the inner
binding INSIDE the host and returns the connection + a teardown.

###### Parameters

###### host

[`HostSpec`](#hostspec)

###### inner

[`DeliveryBinding`](#deliverybinding)

###### costTag

`string`

###### Returns

`Promise`\<[`ProvisionedHost`](#provisionedhost)\>

##### probeLiveToolNames?

> `optional` **probeLiveToolNames?**: (`capabilityId`) => `Promise`\<`string`[]\>

Defined in: [intelligence/resolver.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L106)

Drift probe: return the LIVE tool names a resolved surface exposes for a
given capability id (a `tools/list` over an mcp connection, the agent's
actual registered tool names for a host tool). When present, the post-resolve
drift check drops any tool/mcp whose live names diverge from the certified
interface — the only callable surfaces are gate-blessed ones. Absent ⇒ the
check enforces only the host-side executor↔spec parity (no live probe).

###### Parameters

###### capabilityId

`string`

###### Returns

`Promise`\<`string`[]\>

##### onDrop?

> `optional` **onDrop?**: (`capabilityId`, `error`) => `void`

Defined in: [intelligence/resolver.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L114)

Observe a DROPPED capability — a per-capability resolve failure that is
fail-closed (the capability is omitted, never half-wired). The drop is the
contract; this surfaces the diagnostic so it is never silently erased. NOT
called for [CapabilityNotAdmittedError](#capabilitynotadmittederror) (that rethrows — a manifest
carrying an un-admitted binding kind is a hard error, not a soft drop).

###### Parameters

###### capabilityId

`string`

###### error

`Error`

###### Returns

`void`

## Type Aliases

### JsonSchema

> **JsonSchema** = `Record`\<`string`, `unknown`\>

Defined in: [intelligence/capability.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L37)

A JSON Schema object describing a tool's parameters. Kept structural — the
 resolver forwards it verbatim into a `ToolSpec` / MCP `tools/list` check.

***

### CapabilityInterface

> **CapabilityInterface** = \{ `surface`: `"tool"`; `name`: `string`; `description?`: `string`; `parameters`: [`JsonSchema`](#jsonschema); `returns?`: [`JsonSchema`](#jsonschema); \} \| \{ `surface`: `"mcp"`; `serverName`: `string`; `toolset?`: `string`[]; \} \| \{ `surface`: `"context"`; `kind`: `"prompt-surface"` \| `"skill"` \| `"instructions"`; `name`: `string`; \} \| \{ `surface`: `"retrieval"`; `name`: `string`; `description?`: `string`; `topK?`: `number`; \} \| \{ `surface`: `"hook"`; `event`: `string`; `matcher?`: `string`; \} \| \{ `surface`: `"subagent"`; `name`: `string`; `description?`: `string`; \}

Defined in: [intelligence/capability.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L43)

What the agent consumes. CLOSED — a new runtime kind NEVER extends this. Each
arm maps slot-for-slot onto `AgentProfile` + the host `RouterToolsSeam`.

***

### CapabilitySurface

> **CapabilitySurface** = [`CapabilityInterface`](#capabilityinterface)\[`"surface"`\]

Defined in: [intelligence/capability.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L58)

Every interface surface tag — the closed set the resolver fans into slots.

***

### ContentRef

> **ContentRef** = \{ `kind`: `"inline"`; `content`: `string`; \} \| \{ `kind`: `"github"`; `repository?`: `string`; `path`: `string`; `ref?`: `string`; \} \| \{ `kind`: `"blob"`; `uri`: `string`; `sha256`: `string`; `bytes?`: `number`; \}

Defined in: [intelligence/capability.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L66)

Where a capability's bytes live. A leaked manifest carries no live secret and
no inlined blob: `github`/`blob` are pointers resolved at provision time.

***

### CapabilityAuth

> **CapabilityAuth** = \{ `mode`: `"none"`; \} \| \{ `mode`: `"tangle-key"`; \} \| \{ `mode`: `"hub-connection"`; `providerId`: `string`; `scopes?`: `string`[]; \} \| \{ `mode`: `"secret-ref"`; `key`: `string`; \}

Defined in: [intelligence/capability.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L81)

How a binding authenticates at resolve time. Declared as a REQUIREMENT in the
manifest; the live secret is resolved per-tenant by the resolver context,
never inlined here.

***

### DeliveryBinding

> **DeliveryBinding** = \{ `kind`: `"inline"`; `content`: [`ContentRef`](#contentref); \} \| \{ `kind`: `"file"`; `path`: `string`; `content`: [`ContentRef`](#contentref); `executable?`: `boolean`; \} \| \{ `kind`: `"http"`; `url`: `string`; `method?`: `string`; `auth?`: [`CapabilityAuth`](#capabilityauth); \} \| \{ `kind`: `"sandbox-code"`; `entry`: `string`; `code`: [`ContentRef`](#contentref); `runtime?`: `string`; `harness?`: `string`; \} \| \{ `kind`: `"mcp-stdio"`; `command`: `string`; `args?`: `string`[]; `env?`: `Record`\<`string`, `string`\>; `cwd?`: `string`; \} \| \{ `kind`: `"mcp-remote"`; `url`: `string`; `transport`: `"http"` \| `"sse"`; `headers?`: `Record`\<`string`, `string`\>; \} \| \{ `kind`: `"process-on-infra"`; `host`: [`HostSpec`](#hostspec); `inner`: [`DeliveryBinding`](#deliverybinding); \} \| \{ `kind`: `"rag-index"`; `index`: [`ContentRef`](#contentref); `embedModel`: `string`; `topK?`: `number`; \} \| \{ `kind`: `"memory-store"`; `provision`: `"sqlite"` \| `"neo4j"` \| `"vector"`; `seed?`: [`ContentRef`](#contentref); \} \| \{ `kind`: `"wasm"`; `module`: [`ContentRef`](#contentref); `exports`: `string`[]; \} \| \{ `kind`: `"a2a"`; `endpoint`: `string`; `card`: [`ContentRef`](#contentref); `auth?`: [`CapabilityAuth`](#capabilityauth); \}

Defined in: [intelligence/capability.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L109)

How a capability is backed. OPEN tagged union — THE extension point. All arms
are typed even when the resolver does not yet admit them; an un-admitted arm
throws [CapabilityNotAdmittedError](#capabilitynotadmittederror) at resolve, never silently no-ops.

***

### DeliveryBindingKind

> **DeliveryBindingKind** = [`DeliveryBinding`](#deliverybinding)\[`"kind"`\]

Defined in: [intelligence/capability.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L138)

Every binding kind — the open set the resolver dispatches over.

***

### PullOutcome

> **PullOutcome** = \{ `succeeded`: `true`; `value`: [`CertifiedProfile`](#certifiedprofile); \} \| \{ `succeeded`: `false`; `error`: `string`; `status?`: `number`; \}

Defined in: [intelligence/delivery.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L64)

Typed outcome for the pull — inspect `succeeded` before `value`. A 404
 (nothing promoted yet) is a normal, non-error `succeeded: false`.

***

### DeliveredAgent

> **DeliveredAgent**\<`I`, `O`\> = (`input`, `applied`) => `Promise`\<`O`\>

Defined in: [intelligence/delivery.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L256)

An agent wrapped by [withCertifiedDelivery](#withcertifieddelivery): receives the input plus
 the certified intelligence delivered for this run.

#### Type Parameters

##### I

`I`

##### O

`O`

#### Parameters

##### input

`I`

##### applied

[`AppliedIntelligence`](#appliedintelligence)

#### Returns

`Promise`\<`O`\>

***

### EffortTier

> **EffortTier** = `"off"` \| `"eco"` \| `"standard"` \| `"thorough"` \| `"max"`

Defined in: [intelligence/effort.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L20)

The named effort tiers, lowest to highest. `'off'` is the honest floor
 below `'eco'`: intelligence fully off, telemetry still best-effort.

***

### CorpusAccess

> **CorpusAccess** = `"off"` \| `"read"` \| `"read-write"`

Defined in: [intelligence/effort.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L25)

Corpus access an intelligence tier permits. `'off'` reads and writes
 nothing; `'read'` consults the cross-run corpus without contributing;
 `'read-write'` both consults and accumulates.

***

### EffortOverrides

> **EffortOverrides** = `Partial`\<[`EffortSettings`](#effortsettings)\>

Defined in: [intelligence/effort.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L52)

Per-field overrides applied on top of a tier preset. Any subset of the
 resolved settings; each provided field wins over the preset.

***

### UsageClass

> **UsageClass** = `"inference"` \| `"intelligence"`

Defined in: [intelligence/index.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L104)

Usage class for billing. Base-stream tokens bill `'inference'`; every
 intelligence spawn (analyst, corpus, loop) bills `'intelligence'`. The
 billing line falls on the spawn line.

***

### Agent

> **Agent**\<`TInput`, `TOutput`\> = (`input`) => `Promise`\<`TOutput`\>

Defined in: [intelligence/index.ts:520](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L520)

A generic agent: one async input → output. The shape `withTangleIntelligence`
 preserves exactly.

#### Type Parameters

##### TInput

`TInput`

##### TOutput

`TOutput`

#### Parameters

##### input

`TInput`

#### Returns

`Promise`\<`TOutput`\>

***

### ClientOrConfig

> **ClientOrConfig** = [`IntelligenceClient`](#intelligenceclient) \| [`IntelligenceConfig`](#intelligenceconfig)

Defined in: [intelligence/index.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L523)

Either a built client or the config to build one.

***

### Redactor

> **Redactor** = (`value`) => `unknown`

Defined in: [intelligence/redact.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/redact.ts#L18)

A redactor maps an arbitrary trace value to a safe-to-export value. Pure;
 must not throw on cyclic input (the default tolerates cycles).

#### Parameters

##### value

`unknown`

#### Returns

`unknown`

## Variables

### defaultEffortTier

> `const` **defaultEffortTier**: [`EffortTier`](#efforttier) = `'standard'`

Defined in: [intelligence/effort.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L95)

The default tier when a client declares no effort. `'standard'` turns
 intelligence on with sensible knobs; opt down to `'off'`/`'eco'` or up to
 `'thorough'`/`'max'`.

## Functions

### manifestFromProfile()

> **manifestFromProfile**(`profile`): [`CapabilityManifest`](#capabilitymanifest)

Defined in: [intelligence/capability.ts:366](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L366)

Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`.
`prompt-surface`/`skill` artifacts → `context`/inline capabilities (the
shipped fold, generalized); any other artifact type → best-effort binding
inference (see inferCapability). `promptSurface` is carried through so
the resolver folds it first, exactly as `composeCertifiedPrompt` does today.
This delivers the spine against today's wire before the plane changes.

#### Parameters

##### profile

[`CertifiedProfile`](#certifiedprofile)

#### Returns

[`CapabilityManifest`](#capabilitymanifest)

***

### pullCertified()

> **pullCertified**(`opts`): `Promise`\<[`PullOutcome`](#pulloutcome)\>

Defined in: [intelligence/delivery.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L107)

Pull the certified composed profile for a target. Fail-closed: a network
error or a non-2xx returns a typed `succeeded: false` (never throws), so a
caller can run on its base surface when Intelligence is unreachable. A 404 is
the normal "nothing promoted yet" signal, carried as `status: 404`.

#### Parameters

##### opts

[`PullCertifiedOptions`](#pullcertifiedoptions)

#### Returns

`Promise`\<[`PullOutcome`](#pulloutcome)\>

***

### composeCertifiedPrompt()

> **composeCertifiedPrompt**(`base`, `certified`): `string`

Defined in: [intelligence/delivery.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L167)

Fold the certified prompt surface (and any certified prompt-folding artifacts:
`prompt-surface` / `skill` / `instructions`) into a base system prompt under a
marked section, so the deployed agent prompt == base + the gate-certified
additions. Order is stable (prompt surface first, then artifact buckets in
`promptFoldTypes` order, then by path within a bucket) so the same profile
renders byte-identically each call. Returns `base` unchanged when there is no
usable certified content.

#### Parameters

##### base

`string`

##### certified

[`CertifiedProfile`](#certifiedprofile) \| `null`

#### Returns

`string`

***

### createCertifiedPromptSource()

> **createCertifiedPromptSource**(`opts`): [`CertifiedPromptSource`](#certifiedpromptsource)

Defined in: [intelligence/delivery.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L210)

Create the cached certified-prompt source — the ONE module-scope-cache +
coalesced-refresh + keep-last-known implementation. Product wiring uses this
rather than hand-rolling the same lines around `pullCertified`, and
[withCertifiedDelivery](#withcertifieddelivery) is built on it.

#### Parameters

##### opts

[`CertifiedPromptSourceOptions`](#certifiedpromptsourceoptions)

#### Returns

[`CertifiedPromptSource`](#certifiedpromptsource)

***

### withCertifiedDelivery()

> **withCertifiedDelivery**\<`I`, `O`\>(`agent`, `config`): (`input`) => `Promise`\<`O`\> & `object`

Defined in: [intelligence/delivery.ts:281](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L281)

Wrap an agent so it (a) Observes each run via the shipped Observe client and
(b) RECEIVES the tenant's certified artifacts pulled from the deployed plane.
The certified profile is cached and refreshed at most every `refreshMs`; a
failed pull is fail-closed — the agent runs on its base surface and never
breaks because Intelligence is unreachable. When the plane promotes a new
gate-certified surface, the next refresh delivers it to the running agent.

#### Type Parameters

##### I

`I`

##### O

`O`

#### Parameters

##### agent

[`DeliveredAgent`](#deliveredagent)\<`I`, `O`\>

##### config

[`DeliveryConfig`](#deliveryconfig)

#### Returns

(`input`) => `Promise`\<`O`\> & `object`

***

### resolveEffort()

> **resolveEffort**(`tier`, `overrides?`): [`EffortSettings`](#effortsettings)

Defined in: [intelligence/effort.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L108)

Compile a named tier (plus optional per-field overrides) into the flat
`EffortSettings` the wrapper reads. Pure: same inputs → same object, no I/O,
no execution. Fails loud on an unknown tier rather than silently defaulting —
a typo'd tier must not quietly grant or deny intelligence.

Invariant preserved for the billing floor: `resolveEffort('off')` always
yields `intelligenceBudgetUsd: 0` with every intelligence knob off UNLESS the
caller explicitly overrides a field — overriding off is an opt-in the caller
owns, not a default the composer leaks.

#### Parameters

##### tier

[`EffortTier`](#efforttier)

##### overrides?

`Partial`\<[`EffortSettings`](#effortsettings)\>

#### Returns

[`EffortSettings`](#effortsettings)

***

### isIntelligenceOff()

> **isIntelligenceOff**(`settings`): `boolean`

Defined in: [intelligence/effort.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L129)

True when these settings admit NO intelligence spawn — the passthrough
predicate the wrapper branches on. Every intelligence axis must be off:
analysts disabled, corpus off, no breadth, no loops, and a zero intelligence
budget. A caller who overrides any one of these back on is no longer at the
OFF floor and the wrapper treats them as an intelligence-enabled run.

#### Parameters

##### settings

[`EffortSettings`](#effortsettings)

#### Returns

`boolean`

***

### compileEffort()

> **compileEffort**(`settings`): [`EffortOverridesCompiled`](#effortoverridescompiled)

Defined in: [intelligence/effort.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L179)

Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same
input → same object, no I/O, no execution, no construction. It is the single place that
maps the effort axes onto the run-config knobs, so no `if (effort)` leaks into the
supervise kernel — the kernel stays effort-blind, the caller reads these flags once.

`off`/`eco` (`analysts: false`) compile to `withAnalyst: false` ⇒ the caller omits the
analyst and the run degrades to the dormant base agent rather than throwing. `fanout: 1`
(no breadth) at `off`; `withLoops: false` no-ops the improvement cycle. `standard`+
compile to `withAnalyst: true`, the tier's `fanout`, and `withLoops: true`.

#### Parameters

##### settings

[`EffortSettings`](#effortsettings)

#### Returns

[`EffortOverridesCompiled`](#effortoverridescompiled)

***

### createIntelligenceClient()

> **createIntelligenceClient**(`config`): [`IntelligenceClient`](#intelligenceclient)

Defined in: [intelligence/index.ts:331](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L331)

Create an Observe-mode Intelligence client. Resolves effort, endpoint, and
redactor up front; the exporter is built lazily and is `undefined` when no
endpoint is configured (export becomes a no-op — best-effort by
construction).

#### Parameters

##### config

[`IntelligenceConfig`](#intelligenceconfig)

#### Returns

[`IntelligenceClient`](#intelligenceclient)

***

### withTangleIntelligence()

> **withTangleIntelligence**\<`TInput`, `TOutput`\>(`agent`, `clientOrConfig`): [`Agent`](#agent)\<`TInput`, `TOutput`\>

Defined in: [intelligence/index.ts:538](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L538)

Wrap a generic `agent` with best-effort Observe-mode tracing, returning the
SAME shape. Each call runs the agent under a trace and exports one span; an
export failure is swallowed (the live agent never fails because Intelligence
is down) but an error from the agent itself propagates unchanged.

At `effort: 'off'` this is pure passthrough plus best-effort telemetry —
zero intelligence spawns, `intelligenceUsd: 0` on the trace.

#### Type Parameters

##### TInput

`TInput`

##### TOutput

`TOutput`

#### Parameters

##### agent

[`Agent`](#agent)\<`TInput`, `TOutput`\>

##### clientOrConfig

[`ClientOrConfig`](#clientorconfig)

#### Returns

[`Agent`](#agent)\<`TInput`, `TOutput`\>

***

### defaultRedactor()

> **defaultRedactor**(`value`): `unknown`

Defined in: [intelligence/redact.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/redact.ts#L57)

The built-in redactor. Walks objects and arrays; replaces values under
secret-bearing keys wholesale; scrubs in-value patterns from every string.
Cycle-safe (a seen-set short-circuits self-referential payloads to
`'[circular]'`), depth-bounded, and total — never throws on customer input.

#### Parameters

##### value

`unknown`

#### Returns

`unknown`

***

### resolveRedactor()

> **resolveRedactor**(`redact`): [`Redactor`](#redactor)

Defined in: [intelligence/redact.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/redact.ts#L92)

Resolve the redactor a client uses. A caller-supplied hook replaces the
default entirely (the customer owns their PII rules); absent one, the
built-in `defaultRedactor` runs. Returning `false` is the explicit opt-out —
NO redaction, for a caller who has already sanitized upstream and wants raw
fidelity. Opt-out is loud (an explicit `false`), never a silent default.

#### Parameters

##### redact

`false` \| [`Redactor`](#redactor) \| `undefined`

#### Returns

[`Redactor`](#redactor)

***

### composeCertifiedProfile()

> **composeCertifiedProfile**(`base`, `manifest`, `ctx?`): `Promise`\<[`ResolvedSurface`](#resolvedsurface)\>

Defined in: [intelligence/resolver.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L159)

Compose a certified profile into a uniform `ResolvedSurface`. Additive over
`composeCertifiedPrompt`: the inline/context fold is delegated to
`composeCertifiedPrompt` so the byte-stable ordering (prompt surface first,
then type alphabetic, then path locale-compare) is reused EXACTLY — the
prompt-only path is a strict subset of this.

Fail-closed: a `null` manifest returns the base surface only.

#### Parameters

##### base

###### systemPrompt

`string`

##### manifest

[`CapabilityManifest`](#capabilitymanifest) \| `null`

##### ctx?

[`ResolveCtx`](#resolvectx) = `{}`

#### Returns

`Promise`\<[`ResolvedSurface`](#resolvedsurface)\>

***

### composeCertifiedProfileFromWire()

> **composeCertifiedProfileFromWire**(`base`, `profile`, `ctx?`): `Promise`\<[`ResolvedSurface`](#resolvedsurface)\>

Defined in: [intelligence/resolver.ts:664](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L664)

Lower a plane `CertifiedProfile` straight into a `ResolvedSurface` via
 `manifestFromProfile` — the convenience the shipped pull lane calls when it
 already holds a `CertifiedProfile` (today's wire) rather than a manifest.

#### Parameters

##### base

###### systemPrompt

`string`

##### profile

[`CertifiedProfile`](#certifiedprofile) \| `null`

##### ctx?

[`ResolveCtx`](#resolvectx) = `{}`

#### Returns

`Promise`\<[`ResolvedSurface`](#resolvedsurface)\>
