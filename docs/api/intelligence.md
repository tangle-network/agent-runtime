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

Defined in: [intelligence/delivery.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L35)

A promoted, certified artifact (one entry in the composed profile).

#### Properties

##### path

> **path**: `string` \| `null`

Defined in: [intelligence/delivery.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L36)

##### content

> **content**: `string`

Defined in: [intelligence/delivery.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L37)

##### contentHash

> **contentHash**: `string`

Defined in: [intelligence/delivery.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L38)

##### version

> **version**: `number` \| `null`

Defined in: [intelligence/delivery.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L39)

##### lift

> **lift**: `string` \| `null`

Defined in: [intelligence/delivery.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L42)

Held-out gate lift attached at certification, e.g. "+3.1pp" — never a
 within-run claim. `null` when the promotion carried no lift record.

##### promotedAt

> **promotedAt**: `string`

Defined in: [intelligence/delivery.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L43)

***

### CertifiedPromptSurface

Defined in: [intelligence/delivery.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L47)

The active promoted prompt surface for a target.

#### Properties

##### surface

> **surface**: `string`

Defined in: [intelligence/delivery.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L48)

##### surfaceHash

> **surfaceHash**: `string`

Defined in: [intelligence/delivery.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L49)

##### version

> **version**: `number` \| `null`

Defined in: [intelligence/delivery.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L50)

##### lift

> **lift**: `string` \| `null`

Defined in: [intelligence/delivery.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L51)

***

### DiffProvenance

Defined in: [intelligence/delivery.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L56)

The held-out provenance the plane's certify step stamps on a promoted diff.
 `lift` is the held-out gate lift (e.g. "+3.1pp"), never a within-run claim.

#### Properties

##### version

> **version**: `number` \| `null`

Defined in: [intelligence/delivery.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L57)

##### lift

> **lift**: `string` \| `null`

Defined in: [intelligence/delivery.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L58)

##### contentHash

> **contentHash**: `string`

Defined in: [intelligence/delivery.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L59)

##### promotedAt

> **promotedAt**: `string`

Defined in: [intelligence/delivery.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L60)

***

### ProposedProfileDiff

Defined in: [intelligence/delivery.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L70)

A gate-certified profile diff the plane has already promoted, plus the
held-out provenance it carries. This is the previously-DROPPED typed diff the
composed endpoint returns; `withIntelligence` deserializes it and surfaces it
as a PROPOSAL — a human, or the gated local `improve()` loop, turns a proposal
into a shipped profile. It is NEVER auto-applied at runtime.

#### Properties

##### diff

> **diff**: `AgentProfileDiff`

Defined in: [intelligence/delivery.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L71)

##### provenance

> **provenance**: [`DiffProvenance`](#diffprovenance)

Defined in: [intelligence/delivery.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L72)

***

### CertifiedCapabilitySummary

Defined in: [intelligence/delivery.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L78)

The composed endpoint's per-capability summary — the narrow shape on the
 wire (id + surface + path/content + provenance). Distinct from the richer
 `CertifiedCapability` the capability resolver lowers a manifest into.

#### Properties

##### id

> **id**: `string`

Defined in: [intelligence/delivery.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L79)

##### iface

> **iface**: `object`

Defined in: [intelligence/delivery.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L80)

###### surface

> **surface**: `string`

##### binding

> **binding**: `object`

Defined in: [intelligence/delivery.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L81)

###### path

> **path**: `string` \| `null`

###### content

> **content**: `string`

##### provenance

> **provenance**: [`DiffProvenance`](#diffprovenance)

Defined in: [intelligence/delivery.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L82)

***

### CertifiedProfile

Defined in: [intelligence/delivery.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L87)

The composed certified profile — exactly the shape the plane's
 `GET /v1/profiles/:target/composed` returns.

#### Properties

##### target

> **target**: `string`

Defined in: [intelligence/delivery.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L88)

##### generatedAt

> **generatedAt**: `string`

Defined in: [intelligence/delivery.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L89)

##### promptSurface

> **promptSurface**: [`CertifiedPromptSurface`](#certifiedpromptsurface) \| `null`

Defined in: [intelligence/delivery.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L90)

##### artifacts

> **artifacts**: `Record`\<`string`, [`CertifiedArtifact`](#certifiedartifact)[]\>

Defined in: [intelligence/delivery.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L91)

##### agentProfileDiffs

> **agentProfileDiffs**: [`ProposedProfileDiff`](#proposedprofilediff)[]

Defined in: [intelligence/delivery.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L94)

The typed profile diffs the plane has promoted, each with held-out
 provenance. Surfaced as proposals; never auto-applied. Empty when none.

##### capabilities

> **capabilities**: [`CertifiedCapabilitySummary`](#certifiedcapabilitysummary)[]

Defined in: [intelligence/delivery.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L96)

The composed capability summaries the plane returns. Empty when none.

##### agentProfile

> **agentProfile**: `AgentProfile` \| `null`

Defined in: [intelligence/delivery.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L99)

The composed profile the promoted diffs fold to, for inspection. `null`
 when no diffs are promoted.

***

### PullCertifiedOptions

Defined in: [intelligence/delivery.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L108)

#### Extended by

- [`CertifiedPromptSourceOptions`](#certifiedpromptsourceoptions)

#### Properties

##### target

> **target**: `string`

Defined in: [intelligence/delivery.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L110)

The agent target certified artifacts are promoted under.

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/delivery.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L112)

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [intelligence/delivery.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L115)

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/delivery.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L117)

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

Defined in: [intelligence/delivery.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L121)

Abort the pull after this many ms so a hung plane never blocks the caller.
 Default 10000. The timeout surfaces as a normal fail-closed `succeeded:
 false` (the agent runs on its base surface).

***

### CertifiedPromptSource

Defined in: [intelligence/delivery.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L276)

A cached, self-refreshing source of a target's certified prompt additions —
 the prompt-only delivery lane for callers that assemble their OWN system
 prompt (product chat routes) rather than wrapping an agent fn. Same
 fail-closed semantics as [pullCertified](#pullcertified): pulls at most every
 `refreshMs`, coalesces concurrent pulls, keeps the last-known profile on a
 failed/404 pull, never throws, never blocks past the pull timeout.

#### Methods

##### compose()

> **compose**(`base`): `Promise`\<`string`\>

Defined in: [intelligence/delivery.ts:279](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L279)

Refresh (window-respecting) then fold the certified additions into a
 base system prompt. Returns `base` unchanged when nothing is promoted.

###### Parameters

###### base

`string`

###### Returns

`Promise`\<`string`\>

##### current()

> **current**(): [`CertifiedProfile`](#certifiedprofile) \| `null`

Defined in: [intelligence/delivery.ts:281](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L281)

The certified profile currently in effect (`null` = none pulled yet).

###### Returns

[`CertifiedProfile`](#certifiedprofile) \| `null`

##### refresh()

> **refresh**(): `Promise`\<`void`\>

Defined in: [intelligence/delivery.ts:283](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L283)

Pull now if the refresh window has elapsed; coalesced and fail-closed.

###### Returns

`Promise`\<`void`\>

***

### CertifiedPromptSourceOptions

Defined in: [intelligence/delivery.ts:288](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L288)

Options for [createCertifiedPromptSource](#createcertifiedpromptsource) — the pull coordinates plus
 the refresh cadence.

#### Extends

- [`PullCertifiedOptions`](#pullcertifiedoptions)

#### Properties

##### target

> **target**: `string`

Defined in: [intelligence/delivery.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L110)

The agent target certified artifacts are promoted under.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`target`](#target-2)

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/delivery.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L112)

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`apiKey`](#apikey)

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [intelligence/delivery.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L115)

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`baseUrl`](#baseurl)

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/delivery.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L117)

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

Defined in: [intelligence/delivery.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L121)

Abort the pull after this many ms so a hung plane never blocks the caller.
 Default 10000. The timeout surfaces as a normal fail-closed `succeeded:
 false` (the agent runs on its base surface).

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`timeoutMs`](#timeoutms)

##### refreshMs?

> `optional` **refreshMs?**: `number`

Defined in: [intelligence/delivery.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L290)

Min interval between certified-profile pulls. Default 5m.

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

### AgentImprovementProposal

Defined in: intelligence/improvement-cycle.ts:61

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario` = `Scenario`

##### TArtifact

`TArtifact` = `unknown`

#### Properties

##### schemaVersion

> **schemaVersion**: `1`

Defined in: intelligence/improvement-cycle.ts:65

##### kind

> **kind**: `"agent-improvement-proposal"`

Defined in: intelligence/improvement-cycle.ts:66

##### runId

> **runId**: `string`

Defined in: intelligence/improvement-cycle.ts:67

##### surface

> **surface**: [`ImproveSurface`](index.md#improvesurface)

Defined in: intelligence/improvement-cycle.ts:68

##### proposedAt

> **proposedAt**: `string`

Defined in: intelligence/improvement-cycle.ts:69

##### baselineProfileHash

> **baselineProfileHash**: `string`

Defined in: intelligence/improvement-cycle.ts:70

##### candidateProfile

> **candidateProfile**: `AgentProfile`

Defined in: intelligence/improvement-cycle.ts:71

##### candidateProfileHash

> **candidateProfileHash**: `string`

Defined in: intelligence/improvement-cycle.ts:72

##### findings

> **findings**: `AnalystFinding`[]

Defined in: intelligence/improvement-cycle.ts:73

##### evaluation

> **evaluation**: [`AgentImprovementEvaluation`](#agentimprovementevaluation)\<`TScenario`, `TArtifact`\>

Defined in: intelligence/improvement-cycle.ts:74

##### candidateBundle?

> `optional` **candidateBundle?**: `AgentCandidateBundleV1`

Defined in: intelligence/improvement-cycle.ts:75

##### digest

> **digest**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:76

***

### AgentImprovementReview

Defined in: intelligence/improvement-cycle.ts:81

#### Properties

##### schemaVersion

> **schemaVersion**: `1`

Defined in: intelligence/improvement-cycle.ts:82

##### kind

> **kind**: `"agent-improvement-review"`

Defined in: intelligence/improvement-cycle.ts:83

##### proposalDigest

> **proposalDigest**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:84

##### candidateBundleDigest?

> `optional` **candidateBundleDigest?**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:85

##### decision

> **decision**: [`AgentImprovementReviewDecision`](#agentimprovementreviewdecision)

Defined in: intelligence/improvement-cycle.ts:86

##### reviewedBy

> **reviewedBy**: `string`

Defined in: intelligence/improvement-cycle.ts:87

##### reviewedAt

> **reviewedAt**: `string`

Defined in: intelligence/improvement-cycle.ts:88

##### reason

> **reason**: `string`

Defined in: intelligence/improvement-cycle.ts:89

##### feedback?

> `optional` **feedback?**: `string`

Defined in: intelligence/improvement-cycle.ts:90

##### digest

> **digest**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:91

***

### CandidateExecutionEvidence

Defined in: intelligence/improvement-cycle.ts:94

#### Properties

##### proposalDigest

> **proposalDigest**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:95

##### reviewDigest

> **reviewDigest**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:96

##### bundleDigest

> **bundleDigest**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:97

##### executionId

> **executionId**: `string`

Defined in: intelligence/improvement-cycle.ts:98

##### executionPlanDigest

> **executionPlanDigest**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:99

##### materializationReceiptDigest

> **materializationReceiptDigest**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:100

##### succeeded

> **succeeded**: `boolean`

Defined in: intelligence/improvement-cycle.ts:101

##### runReceiptDigest?

> `optional` **runReceiptDigest?**: `` `sha256:${string}` ``

Defined in: intelligence/improvement-cycle.ts:102

***

### ProposeAgentImprovementOptions

Defined in: intelligence/improvement-cycle.ts:105

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### runId

> **runId**: `string`

Defined in: intelligence/improvement-cycle.ts:106

##### profile

> **profile**: `AgentProfile`

Defined in: intelligence/improvement-cycle.ts:107

##### analysis

> **analysis**: `Omit`\<[`RunAnalystLoopOpts`](analyst-loop.md#runanalystloopopts), `"runId"` \| `"improvementAdapter"` \| `"autoApply"`\>

Defined in: intelligence/improvement-cycle.ts:108

##### improvement

> **improvement**: [`ImproveOptions`](index.md#improveoptions)\<`TScenario`, `TArtifact`\>

Defined in: intelligence/improvement-cycle.ts:109

##### buildCandidate?

> `optional` **buildCandidate?**: (`input`) => `AgentCandidateBundleInput` \| `Promise`\<`AgentCandidateBundleInput`\>

Defined in: intelligence/improvement-cycle.ts:115

Optional environment adapter that freezes an executable bundle after the
measured comparison recommends the candidate. Runtime validates and
computes the bundle digest; adapters never implement hashing themselves.

###### Parameters

###### input

###### analysis

[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)

###### improvement

[`ImproveResult`](index.md#improveresult)\<`TScenario`, `TArtifact`\>

###### Returns

`AgentCandidateBundleInput` \| `Promise`\<`AgentCandidateBundleInput`\>

##### now?

> `optional` **now?**: () => `Date`

Defined in: intelligence/improvement-cycle.ts:119

###### Returns

`Date`

***

### ProposeAgentImprovementResult

Defined in: intelligence/improvement-cycle.ts:122

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### analysis

> **analysis**: [`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)

Defined in: intelligence/improvement-cycle.ts:123

##### improvement

> **improvement**: [`ImproveResult`](index.md#improveresult)\<`TScenario`, `TArtifact`\>

Defined in: intelligence/improvement-cycle.ts:124

##### proposal

> **proposal**: [`AgentImprovementProposal`](#agentimprovementproposal)\<`TScenario`, `TArtifact`\>

Defined in: intelligence/improvement-cycle.ts:125

***

### ReviewAgentImprovementInput

Defined in: intelligence/improvement-cycle.ts:128

#### Properties

##### decision

> **decision**: [`AgentImprovementReviewDecision`](#agentimprovementreviewdecision)

Defined in: intelligence/improvement-cycle.ts:129

##### reviewedBy

> **reviewedBy**: `string`

Defined in: intelligence/improvement-cycle.ts:130

##### reason

> **reason**: `string`

Defined in: intelligence/improvement-cycle.ts:131

##### feedback?

> `optional` **feedback?**: `string`

Defined in: intelligence/improvement-cycle.ts:132

##### now?

> `optional` **now?**: () => `Date`

Defined in: intelligence/improvement-cycle.ts:133

###### Returns

`Date`

***

### ExecuteApprovedAgentCandidateOptions

Defined in: intelligence/improvement-cycle.ts:136

#### Properties

##### proposal

> **proposal**: [`AgentImprovementProposal`](#agentimprovementproposal)

Defined in: intelligence/improvement-cycle.ts:137

##### review

> **review**: [`AgentImprovementReview`](#agentimprovementreview)

Defined in: intelligence/improvement-cycle.ts:138

##### authorizeReview

> **authorizeReview**: (`review`, `proposal`) => `boolean` \| `Promise`\<`boolean`\>

Defined in: intelligence/improvement-cycle.ts:140

Product-owned authentication check for the persisted approval record.

###### Parameters

###### review

[`AgentImprovementReview`](#agentimprovementreview)

###### proposal

[`AgentImprovementProposal`](#agentimprovementproposal)

###### Returns

`boolean` \| `Promise`\<`boolean`\>

##### task

> **task**: [`AgentCandidateTaskExecution`](index.md#agentcandidatetaskexecution)

Defined in: intelligence/improvement-cycle.ts:144

##### ports

> **ports**: [`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports)

Defined in: intelligence/improvement-cycle.ts:145

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

Defined in: intelligence/improvement-cycle.ts:146

##### execution

> **execution**: [`ExecutePreparedAgentCandidateOptions`](index.md#executepreparedagentcandidateoptions)

Defined in: intelligence/improvement-cycle.ts:147

***

### ExecuteApprovedAgentCandidateResult

Defined in: intelligence/improvement-cycle.ts:150

#### Properties

##### finalization

> **finalization**: [`AgentCandidateRunFinalization`](index.md#agentcandidaterunfinalization)

Defined in: intelligence/improvement-cycle.ts:151

##### evidence

> **evidence**: [`CandidateExecutionEvidence`](#candidateexecutionevidence)

Defined in: intelligence/improvement-cycle.ts:152

***

### UsageSplit

Defined in: [intelligence/index.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L140)

The per-class cost split carried by every trace and outcome. `off` ⇒
`intelligenceUsd: 0` by construction — there is no intelligence spawn to
bill. This is a classification on the trace, NOT a budget-pool split.

#### Properties

##### inferenceUsd

> **inferenceUsd**: `number`

Defined in: [intelligence/index.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L142)

Base-stream (model) spend in USD.

##### intelligenceUsd

> **intelligenceUsd**: `number`

Defined in: [intelligence/index.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L144)

Intelligence-spawn spend in USD. Provably `0` at the OFF tier.

***

### RunRecord

Defined in: [intelligence/index.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L154)

The typed record `withIntelligence` sends per call — serialized through the
shipped OTLP builders to the plane's `/v1/otlp` ingest. `input`/`output` are
redacted on export; the per-class `usage` split carries the billing proof;
`loopEvents`, when present, export as the nested loop→round→iteration span
tree under the same `traceId`.

#### Properties

##### runId

> **runId**: `string`

Defined in: [intelligence/index.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L155)

##### traceId

> **traceId**: `string`

Defined in: [intelligence/index.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L156)

##### project

> **project**: `string`

Defined in: [intelligence/index.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L157)

##### target

> **target**: `string`

Defined in: [intelligence/index.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L158)

##### input

> **input**: `unknown`

Defined in: [intelligence/index.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L159)

##### output

> **output**: `unknown`

Defined in: [intelligence/index.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L160)

##### outcome

> **outcome**: `object`

Defined in: [intelligence/index.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L161)

###### success?

> `optional` **success?**: `boolean`

###### score?

> `optional` **score?**: `number`

###### usage

> **usage**: [`UsageSplit`](#usagesplit)

##### model?

> `optional` **model?**: `string`

Defined in: [intelligence/index.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L166)

##### provider?

> `optional` **provider?**: `string`

Defined in: [intelligence/index.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L167)

##### loopEvents?

> `optional` **loopEvents?**: [`LoopTraceEvent`](runtime.md#looptraceevent)[]

Defined in: [intelligence/index.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L168)

##### runtimeEvents?

> `optional` **runtimeEvents?**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

Defined in: [intelligence/index.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L169)

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [intelligence/index.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L170)

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [intelligence/index.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L171)

##### harness?

> `optional` **harness?**: `string`

Defined in: [intelligence/index.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L172)

##### repository?

> `optional` **repository?**: `string`

Defined in: [intelligence/index.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L173)

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: [intelligence/index.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L174)

##### timing?

> `optional` **timing?**: `object`

Defined in: [intelligence/index.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L175)

###### startedAt

> **startedAt**: `number`

###### completedAt

> **completedAt**: `number`

###### durationMs

> **durationMs**: `number`

##### tokens?

> `optional` **tokens?**: `object`

Defined in: [intelligence/index.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L176)

###### input

> **input**: `number`

###### output

> **output**: `number`

###### cachedInput?

> `optional` **cachedInput?**: `number`

###### reasoning?

> `optional` **reasoning?**: `number`

##### error?

> `optional` **error?**: `object`

Defined in: [intelligence/index.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L182)

###### name

> **name**: `string`

###### message

> **message**: `string`

###### code?

> `optional` **code?**: `string`

##### candidateExecution?

> `optional` **candidateExecution?**: [`CandidateExecutionEvidence`](#candidateexecutionevidence)

Defined in: [intelligence/index.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L184)

Exact proposal → review → execution → receipt linkage for candidate runs.

***

### RunReport

Defined in: [intelligence/index.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L193)

What an agent reports (via `applied.record`) to enrich the [RunRecord](#runrecord)
sent for its call. All optional — an un-recorded run still sends input/output
with an inference-only zero usage split. `costUsd` without a split is treated
as pure inference (the base stream).

#### Properties

##### success?

> `optional` **success?**: `boolean`

Defined in: [intelligence/index.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L194)

##### score?

> `optional` **score?**: `number`

Defined in: [intelligence/index.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L195)

##### usage?

> `optional` **usage?**: `Partial`\<[`UsageSplit`](#usagesplit)\>

Defined in: [intelligence/index.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L196)

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [intelligence/index.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L197)

##### model?

> `optional` **model?**: `string`

Defined in: [intelligence/index.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L198)

##### provider?

> `optional` **provider?**: `string`

Defined in: [intelligence/index.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L199)

##### loopEvents?

> `optional` **loopEvents?**: [`LoopTraceEvent`](runtime.md#looptraceevent)[]

Defined in: [intelligence/index.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L200)

##### runtimeEvents?

> `optional` **runtimeEvents?**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

Defined in: [intelligence/index.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L201)

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [intelligence/index.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L202)

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [intelligence/index.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L203)

##### harness?

> `optional` **harness?**: `string`

Defined in: [intelligence/index.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L204)

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: [intelligence/index.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L205)

##### tokens?

> `optional` **tokens?**: `object`

Defined in: [intelligence/index.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L206)

###### input

> **input**: `number`

###### output

> **output**: `number`

###### cachedInput?

> `optional` **cachedInput?**: `number`

###### reasoning?

> `optional` **reasoning?**: `number`

##### error?

> `optional` **error?**: `object`

Defined in: [intelligence/index.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L207)

###### name

> **name**: `string`

###### message

> **message**: `string`

###### code?

> `optional` **code?**: `string`

##### candidateExecution?

> `optional` **candidateExecution?**: [`CandidateExecutionEvidence`](#candidateexecutionevidence)

Defined in: [intelligence/index.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L208)

***

### RepoConfig

Defined in: [intelligence/index.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L214)

Repo coordinates a product may declare for the (later) Gated-PR mode. The
 Observe slice only records their PRESENCE for `doctor()`; it never touches
 the repo.

#### Properties

##### owner

> **owner**: `string`

Defined in: [intelligence/index.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L215)

##### name

> **name**: `string`

Defined in: [intelligence/index.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L216)

##### baseBranch

> **baseBranch**: `string`

Defined in: [intelligence/index.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L217)

***

### IntelligenceConfig

Defined in: [intelligence/index.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L223)

Client configuration. `project` + `apiKey` are the Observe minimum; the
 rest tune effort, endpoint, redaction, and (for `doctor()` readiness)
 declare the surfaces/checks/repo a later PR mode would need.

#### Extended by

- [`IntelligenceHookConfig`](#intelligencehookconfig)

#### Properties

##### project

> **project**: `string`

Defined in: [intelligence/index.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L225)

Stable project id — the tenant dimension every trace is tagged with.

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/index.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L227)

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Defined in: [intelligence/index.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L229)

Effort tier (default `'standard'`) plus optional per-field overrides.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [intelligence/index.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L237)

The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
receive (`/v1/profiles/:target/composed`) paths derive from it. Reads
`TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
Send is best-effort and only ships when an `apiKey` is present (the tenant
key the ingest requires); absent a key, export is a no-op.

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Defined in: [intelligence/index.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L243)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

##### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: [intelligence/index.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L245)

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

##### checks?

> `optional` **checks?**: `string`[]

Defined in: [intelligence/index.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L247)

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Defined in: [intelligence/index.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L249)

Repo access a later PR mode would need. Recorded for `doctor()` only.

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [intelligence/index.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L251)

Full canonical profile used for this agent. Exported redacted with a stable hash.

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: [intelligence/index.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L253)

Commit that produced the running agent, when known.

##### runtimeTelemetry?

> `optional` **runtimeTelemetry?**: [`RuntimeTelemetryOptions`](index.md#runtimetelemetryoptions)

Defined in: [intelligence/index.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L255)

Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled.

##### payloadAttributes?

> `optional` **payloadAttributes?**: `"metadata"` \| `"full"`

Defined in: [intelligence/index.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L262)

Payloads are metadata-only by default: the run span carries a stable hash
and UTF-8 byte count, but not the redacted content. Set `full` only when
the configured OTLP destination is approved to receive complete redacted
inputs, outputs, and profiles.

***

### TraceMeta

Defined in: [intelligence/index.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L266)

Metadata describing one traced run. `runId`/`traceId` default to fresh ids.

#### Properties

##### input?

> `optional` **input?**: `unknown`

Defined in: [intelligence/index.ts:268](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L268)

The run's input — exported through the redactor.

##### runId?

> `optional` **runId?**: `string`

Defined in: [intelligence/index.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L270)

Stable run id. Defaults to a fresh id.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [intelligence/index.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L272)

32-hex trace id. Defaults to a fresh id.

##### model?

> `optional` **model?**: `string`

Defined in: [intelligence/index.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L274)

Model id, when known — stamped on the span.

##### provider?

> `optional` **provider?**: `string`

Defined in: [intelligence/index.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L276)

Provider name, when known — stamped on the span.

##### labels?

> `optional` **labels?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [intelligence/index.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L278)

Arbitrary extra labels (string/number/boolean) stamped on the span.

***

### TraceHandle

Defined in: [intelligence/index.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L287)

The trace handle a `traceRun` body records into. `recordOutput` captures the
agent's result (redacted on export); `recordOutcome` captures the scored
outcome + the `{ inferenceUsd, intelligenceUsd }` split. Both are optional —
an un-recorded run still exports a span with whatever was set.

#### Methods

##### recordOutput()

> **recordOutput**(`output`): `void`

Defined in: [intelligence/index.ts:289](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L289)

Capture the run's output. Exported through the redactor.

###### Parameters

###### output

`unknown`

###### Returns

`void`

##### recordOutcome()

> **recordOutcome**(`outcome`): `void`

Defined in: [intelligence/index.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L296)

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

Defined in: [intelligence/index.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L305)

Metadata for [IntelligenceClient.recordTrace](#recordtrace).

#### Properties

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [intelligence/index.ts:307](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L307)

32-hex trace id to anchor every span to. Defaults to a fresh id.

##### rootParentSpanId?

> `optional` **rootParentSpanId?**: `string`

Defined in: [intelligence/index.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L310)

Span id of an enclosing span the loop root should parent under (e.g. a
 `traceRun` span). Omitted ⇒ the loop root is the trace root.

***

### TraceOutcome

Defined in: [intelligence/index.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L315)

The resolved outcome of one traced run, surfaced on the export span and
 available to the caller for downstream billing assertions.

#### Properties

##### runId

> **runId**: `string`

Defined in: [intelligence/index.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L316)

##### traceId

> **traceId**: `string`

Defined in: [intelligence/index.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L317)

##### project

> **project**: `string`

Defined in: [intelligence/index.ts:318](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L318)

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

Defined in: [intelligence/index.ts:320](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L320)

The resolved effort settings this run executed under.

##### intelligenceOff

> **intelligenceOff**: `boolean`

Defined in: [intelligence/index.ts:322](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L322)

True when this run ran as pure passthrough (the OFF floor).

##### success?

> `optional` **success?**: `boolean`

Defined in: [intelligence/index.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L323)

##### score?

> `optional` **score?**: `number`

Defined in: [intelligence/index.ts:324](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L324)

##### usage

> **usage**: [`UsageSplit`](#usagesplit)

Defined in: [intelligence/index.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L326)

Per-class billing split. `intelligenceUsd` is `0` at the OFF tier.

***

### IntelligenceClient

Defined in: [intelligence/index.ts:330](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L330)

The Observe-mode Intelligence client.

#### Properties

##### project

> `readonly` **project**: `string`

Defined in: [intelligence/index.ts:332](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L332)

The resolved project id.

##### effort

> `readonly` **effort**: [`EffortSettings`](#effortsettings)

Defined in: [intelligence/index.ts:334](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L334)

The resolved effort settings.

#### Methods

##### traceRun()

> **traceRun**\<`T`\>(`meta`, `fn`): `Promise`\<`T`\>

Defined in: [intelligence/index.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L340)

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

Defined in: [intelligence/index.ts:350](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L350)

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

##### exportRunRecord()

> **exportRunRecord**(`record`): `string`

Defined in: [intelligence/index.ts:358](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L358)

Send one typed [RunRecord](#runrecord) — the run's flat span (input/output/outcome/
usage/model/provider, redacted) plus, when `loopEvents` are present, the
nested loop topology under the same `traceId`. Reuses the shipped
`flatOtelSpan` + `buildLoopOtelSpans` builders (no second builder).
Best-effort: export failures are swallowed. Returns the record's `traceId`.

###### Parameters

###### record

[`RunRecord`](#runrecord)

###### Returns

`string`

##### freshRunId()

> **freshRunId**(): `string`

Defined in: [intelligence/index.ts:360](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L360)

Mint a fresh run id (`run-<hex>`).

###### Returns

`string`

##### freshTraceId()

> **freshTraceId**(): `string`

Defined in: [intelligence/index.ts:362](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L362)

Mint a fresh 32-hex trace id.

###### Returns

`string`

##### doctor()

> **doctor**(): [`DoctorReport`](#doctorreport)

Defined in: [intelligence/index.ts:368](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L368)

Network-free readiness report: which adoption modes are reachable given
this config. Observe is always reachable; Recommend needs outcomes; PR
needs checks + surfaces + repo.

###### Returns

[`DoctorReport`](#doctorreport)

##### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [intelligence/index.ts:370](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L370)

Flush any pending export spans. Best-effort; resolves even if export fails.

###### Returns

`Promise`\<`void`\>

***

### ModeReadiness

Defined in: [intelligence/index.ts:374](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L374)

One mode's readiness verdict.

#### Properties

##### ready

> **ready**: `boolean`

Defined in: [intelligence/index.ts:375](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L375)

##### missing

> **missing**: `string`[]

Defined in: [intelligence/index.ts:377](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L377)

Inputs this mode still needs, when not ready. Empty when ready.

***

### DoctorReport

Defined in: [intelligence/index.ts:381](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L381)

The `doctor()` readiness report — Mode-readiness without any network call.

#### Properties

##### project

> **project**: `string`

Defined in: [intelligence/index.ts:382](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L382)

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

Defined in: [intelligence/index.ts:383](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L383)

##### exportConfigured

> **exportConfigured**: `boolean`

Defined in: [intelligence/index.ts:385](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L385)

True when an OTLP endpoint is configured (export will actually ship).

##### modes

> **modes**: `object`

Defined in: [intelligence/index.ts:386](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L386)

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

***

### AppliedIntelligence

Defined in: [intelligence/with-intelligence.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L53)

What the hook hands the agent each run. Additive over the prompt-only
 delivery: `composePrompt` folds the certified prompt surface (as before);
 `proposals`/`applyProfile` surface the promoted profile DIFFS — never
 auto-applied; `record` enriches the [RunRecord](#runrecord) that is sent.

#### Properties

##### runId

> **runId**: `string`

Defined in: [intelligence/with-intelligence.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L55)

Stable ids shared by the run span and every nested runtime/loop span.

##### traceId

> **traceId**: `string`

Defined in: [intelligence/with-intelligence.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L56)

##### certified

> **certified**: [`CertifiedProfile`](#certifiedprofile) \| `null`

Defined in: [intelligence/with-intelligence.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L59)

The certified profile in effect (null when none promoted / pull failed —
 fail-closed: the agent runs on its base surface).

##### proposals

> **proposals**: [`ProposedProfileDiff`](#proposedprofilediff)[]

Defined in: [intelligence/with-intelligence.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L65)

The promoted, gate-certified profile diffs — surfaced for a human or the
 gated `improve()` loop. NEVER auto-applied by this hook. Empty when none.

#### Methods

##### composePrompt()

> **composePrompt**(`base`): `string`

Defined in: [intelligence/with-intelligence.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L62)

Fold the certified prompt surface into a base system prompt (the promoted
 prompt). The consumer opts in by calling it.

###### Parameters

###### base

`string`

###### Returns

`string`

##### applyProfile()

> **applyProfile**(`base`): `AgentProfile`

Defined in: [intelligence/with-intelligence.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L69)

Fold every proposal into `base` via `applyAgentProfileDiff`, in promotion
 order, and return the result. The caller invokes this EXPLICITLY (it is the
 human/gated apply step) — the hook never calls it on the run path.

###### Parameters

###### base

`AgentProfile`

###### Returns

`AgentProfile`

##### record()

> **record**(`report`): `void`

Defined in: [intelligence/with-intelligence.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L73)

Enrich the [RunRecord](#runrecord) sent for this call — outcome, usage split,
 model/provider, and the loop event stream. Optional; an un-recorded run
 still sends input/output with an inference-only zero usage split.

###### Parameters

###### report

[`RunReport`](#runreport)

###### Returns

`void`

***

### IntelligenceHookConfig

Defined in: [intelligence/with-intelligence.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L83)

`withIntelligence` config = the Observe config plus the pull target, refresh
 cadence, and a proposals callback. One base URL (`baseUrl` /
 `TANGLE_INTELLIGENCE_URL`) drives both the send and receive paths.

#### Extends

- [`IntelligenceConfig`](#intelligenceconfig)

#### Properties

##### project

> **project**: `string`

Defined in: [intelligence/index.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L225)

Stable project id — the tenant dimension every trace is tagged with.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`project`](#project-1)

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/index.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L227)

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`apiKey`](#apikey-2)

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Defined in: [intelligence/index.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L229)

Effort tier (default `'standard'`) plus optional per-field overrides.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`effort`](#effort)

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [intelligence/index.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L237)

The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
receive (`/v1/profiles/:target/composed`) paths derive from it. Reads
`TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
Send is best-effort and only ships when an `apiKey` is present (the tenant
key the ingest requires); absent a key, export is a no-op.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`baseUrl`](#baseurl-2)

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Defined in: [intelligence/index.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L243)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`redact`](#redact)

##### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: [intelligence/index.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L245)

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`surfaces`](#surfaces)

##### checks?

> `optional` **checks?**: `string`[]

Defined in: [intelligence/index.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L247)

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`checks`](#checks)

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Defined in: [intelligence/index.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L249)

Repo access a later PR mode would need. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`repo`](#repo)

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [intelligence/index.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L251)

Full canonical profile used for this agent. Exported redacted with a stable hash.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`profile`](#profile-3)

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: [intelligence/index.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L253)

Commit that produced the running agent, when known.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`commitSha`](#commitsha-2)

##### runtimeTelemetry?

> `optional` **runtimeTelemetry?**: [`RuntimeTelemetryOptions`](index.md#runtimetelemetryoptions)

Defined in: [intelligence/index.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L255)

Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`runtimeTelemetry`](#runtimetelemetry)

##### payloadAttributes?

> `optional` **payloadAttributes?**: `"metadata"` \| `"full"`

Defined in: [intelligence/index.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L262)

Payloads are metadata-only by default: the run span carries a stable hash
and UTF-8 byte count, but not the redacted content. Set `full` only when
the configured OTLP destination is approved to receive complete redacted
inputs, outputs, and profiles.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`payloadAttributes`](#payloadattributes)

##### target?

> `optional` **target?**: `string`

Defined in: [intelligence/with-intelligence.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L85)

Pull target. Defaults to `project`.

##### refreshMs?

> `optional` **refreshMs?**: `number`

Defined in: [intelligence/with-intelligence.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L87)

Min interval between certified-profile pulls. Default 5m.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [intelligence/with-intelligence.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L89)

Per-pull timeout in ms (fail-closed on a hung plane). Default 10000.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/with-intelligence.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L91)

fetch impl for the pull (tests). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### onProposals?

> `optional` **onProposals?**: (`proposals`) => `void`

Defined in: [intelligence/with-intelligence.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L94)

Notified when a refresh delivers a NEW set of promoted proposals (by
 provenance content hash). Surfaces diffs without auto-applying them.

###### Parameters

###### proposals

[`ProposedProfileDiff`](#proposedprofilediff)[]

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

Defined in: [intelligence/delivery.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L104)

Typed outcome for the pull — inspect `succeeded` before `value`. A 404
 (nothing promoted yet) is a normal, non-error `succeeded: false`.

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

### AgentImprovementEvaluation

> **AgentImprovementEvaluation**\<`TScenario`, `TArtifact`\> = `Pick`\<`SelfImproveResult`\<`TScenario`, `TArtifact`\>, `"baseline"` \| `"winner"` \| `"lift"` \| `"diff"` \| `"provenance"` \| `"gateDecision"` \| `"generationsExplored"` \| `"durationMs"` \| `"totalCostUsd"` \| `"insight"` \| `"power"`\>

Defined in: intelligence/improvement-cycle.ts:46

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### AgentImprovementReviewDecision

> **AgentImprovementReviewDecision** = `"approve"` \| `"reject"` \| `"request-changes"`

Defined in: intelligence/improvement-cycle.ts:79

***

### UsageClass

> **UsageClass** = `"inference"` \| `"intelligence"`

Defined in: [intelligence/index.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L133)

Usage class for billing. Base-stream tokens bill `'inference'`; every
 intelligence spawn (analyst, corpus, loop) bills `'intelligence'`. The
 billing line falls on the spawn line.

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

***

### IntelligenceAgent

> **IntelligenceAgent**\<`I`, `O`\> = (`input`, `applied`) => `Promise`\<`O`\>

Defined in: [intelligence/with-intelligence.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L78)

An agent wrapped by [withIntelligence](#withintelligence): receives the input plus the
 intelligence delivered for this run.

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

### IntelligenceWrapped

> **IntelligenceWrapped**\<`I`, `O`\> = (`input`) => `Promise`\<`O`\> & `object`

Defined in: [intelligence/with-intelligence.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L99)

The wrapped agent — same `(input) => Promise<output>` shape, plus a manual
 `refresh()` and a `proposals()` accessor for the currently-promoted diffs.

#### Type Declaration

##### refresh()

> **refresh**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

##### proposals()

> **proposals**(): [`ProposedProfileDiff`](#proposedprofilediff)[]

###### Returns

[`ProposedProfileDiff`](#proposedprofilediff)[]

##### flush()

> **flush**(): `Promise`\<`void`\>

Flush buffered trace spans before a short-lived process exits.

###### Returns

`Promise`\<`void`\>

#### Type Parameters

##### I

`I`

##### O

`O`

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

### resolveIntelligenceBaseUrl()

> **resolveIntelligenceBaseUrl**(`baseUrl`): `string`

Defined in: [intelligence/delivery.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L128)

Resolve the ONE Intelligence base URL — the single knob both the send and
 receive paths derive from. Env fallback: `TANGLE_INTELLIGENCE_URL`.

#### Parameters

##### baseUrl

`string` \| `undefined`

#### Returns

`string`

***

### normalizeCertifiedProfile()

> **normalizeCertifiedProfile**(`raw`): [`CertifiedProfile`](#certifiedprofile)

Defined in: [intelligence/delivery.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L163)

Deserialize the composed-endpoint response into a `CertifiedProfile`. The
previously-dropped `agentProfileDiffs`/`capabilities`/`agentProfile` are read
here so they round-trip to the consumer; a plane that has not yet promoted any
diffs simply yields empty arrays / a null profile (fail-closed, never a crash).

#### Parameters

##### raw

`unknown`

#### Returns

[`CertifiedProfile`](#certifiedprofile)

***

### pullCertified()

> **pullCertified**(`opts`): `Promise`\<[`PullOutcome`](#pulloutcome)\>

Defined in: [intelligence/delivery.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L193)

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

Defined in: [intelligence/delivery.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L253)

Fold the certified prompt surface (and any certified prompt-folding artifacts:
`prompt-surface` / `skill` / `instructions`) into a base system prompt under a
marked section, so the deployed agent prompt == base + the gate-certified
additions. Order is stable (prompt surface first, then artifact buckets in
`promptFoldTypes` order, then by path within a bucket) so the same profile
renders byte-identically each call. Returns `base` unchanged when there is no
usable certified content. Reads only the prompt-folding slice of a profile.

#### Parameters

##### base

`string`

##### certified

`Pick`\<[`CertifiedProfile`](#certifiedprofile), `"promptSurface"` \| `"artifacts"`\> \| `null`

#### Returns

`string`

***

### createCertifiedPromptSource()

> **createCertifiedPromptSource**(`opts`): [`CertifiedPromptSource`](#certifiedpromptsource)

Defined in: [intelligence/delivery.ts:299](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L299)

Create the cached certified-prompt source — the ONE module-scope-cache +
coalesced-refresh + keep-last-known implementation. Product wiring uses this
rather than hand-rolling the same lines around `pullCertified`. The
`withIntelligence` hook rides this same source for its prompt delivery.

#### Parameters

##### opts

[`CertifiedPromptSourceOptions`](#certifiedpromptsourceoptions)

#### Returns

[`CertifiedPromptSource`](#certifiedpromptsource)

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

### proposeAgentImprovement()

> **proposeAgentImprovement**\<`TScenario`, `TArtifact`\>(`options`): `Promise`\<[`ProposeAgentImprovementResult`](#proposeagentimprovementresult)\<`TScenario`, `TArtifact`\>\>

Defined in: intelligence/improvement-cycle.ts:156

Analyze one run and produce one measured, review-only improvement proposal.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### options

[`ProposeAgentImprovementOptions`](#proposeagentimprovementoptions)\<`TScenario`, `TArtifact`\>

#### Returns

`Promise`\<[`ProposeAgentImprovementResult`](#proposeagentimprovementresult)\<`TScenario`, `TArtifact`\>\>

***

### reviewAgentImprovementProposal()

> **reviewAgentImprovementProposal**(`inputProposal`, `input`): [`AgentImprovementReview`](#agentimprovementreview)

Defined in: intelligence/improvement-cycle.ts:198

Persist an approve/reject/change-request decision bound to one exact proposal.

#### Parameters

##### inputProposal

[`AgentImprovementProposal`](#agentimprovementproposal)

##### input

[`ReviewAgentImprovementInput`](#reviewagentimprovementinput)

#### Returns

[`AgentImprovementReview`](#agentimprovementreview)

***

### executeApprovedAgentCandidate()

> **executeApprovedAgentCandidate**(`options`): `Promise`\<[`ExecuteApprovedAgentCandidateResult`](#executeapprovedagentcandidateresult)\>

Defined in: intelligence/improvement-cycle.ts:228

Verify, materialize, run, grade, and receipt only the exact approved bundle.

#### Parameters

##### options

[`ExecuteApprovedAgentCandidateOptions`](#executeapprovedagentcandidateoptions)

#### Returns

`Promise`\<[`ExecuteApprovedAgentCandidateResult`](#executeapprovedagentcandidateresult)\>

***

### verifyAgentImprovementProposal()

> **verifyAgentImprovementProposal**(`input`): [`AgentImprovementProposal`](#agentimprovementproposal)

Defined in: intelligence/improvement-cycle.ts:270

Validate a proposal's schema, profile, sealed bundle, and canonical digest.

#### Parameters

##### input

`unknown`

#### Returns

[`AgentImprovementProposal`](#agentimprovementproposal)

***

### verifyAgentImprovementReview()

> **verifyAgentImprovementReview**(`input`): [`AgentImprovementReview`](#agentimprovementreview)

Defined in: intelligence/improvement-cycle.ts:442

Validate a review's decision fields and canonical digest.

#### Parameters

##### input

`unknown`

#### Returns

[`AgentImprovementReview`](#agentimprovementreview)

***

### createIntelligenceClient()

> **createIntelligenceClient**(`config`): [`IntelligenceClient`](#intelligenceclient)

Defined in: [intelligence/index.ts:452](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L452)

Create an Observe-mode Intelligence client. Resolves effort, the base URL, and
the redactor up front; the exporter is built lazily and is `undefined` when no
`apiKey` is present (send becomes a no-op — the ingest requires a tenant key,
and best-effort export must never spam an unauthenticated plane).

#### Parameters

##### config

[`IntelligenceConfig`](#intelligenceconfig)

#### Returns

[`IntelligenceClient`](#intelligenceclient)

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

Defined in: [intelligence/resolver.ts:660](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L660)

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

***

### withIntelligence()

> **withIntelligence**\<`I`, `O`\>(`agent`, `config`): [`IntelligenceWrapped`](#intelligencewrapped)\<`I`, `O`\>

Defined in: [intelligence/with-intelligence.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L169)

Wrap an agent so it (a) RECEIVES the tenant's certified profile — the prompt
surface to fold and the promoted profile diffs as proposals — and (b) SENDS a
typed [RunRecord](#runrecord) per call to the plane. The pull is cached and refreshed
at most every `refreshMs`; a failed pull is fail-closed (the agent runs on its
base surface, never breaks because Intelligence is unreachable). The send is
best-effort — an export failure never fails the agent's turn — while an error
thrown by the agent itself propagates unchanged.

#### Type Parameters

##### I

`I`

##### O

`O`

#### Parameters

##### agent

[`IntelligenceAgent`](#intelligenceagent)\<`I`, `O`\>

##### config

[`IntelligenceHookConfig`](#intelligencehookconfig)

#### Returns

[`IntelligenceWrapped`](#intelligencewrapped)\<`I`, `O`\>
