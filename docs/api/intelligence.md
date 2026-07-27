[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / intelligence

# intelligence

## Classes

### CapabilityNotAdmittedError

Defined in: [src/intelligence/capability.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L246)

A binding kind whose resolver case is typed but not yet admitted (rag-index,
memory-store, wasm, a2a). Thrown by the resolver — NEVER faked into a working
surface. The TYPE arms exist so the union is closed against the spec; the
resolver grows them later behind their lifecycle + admission gate.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CapabilityNotAdmittedError**(`kind`, `capabilityId`, `reason`): [`CapabilityNotAdmittedError`](#capabilitynotadmittederror)

Defined in: [src/intelligence/capability.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L249)

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

Defined in: [src/intelligence/capability.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L247)

##### capabilityId

> `readonly` **capabilityId**: `string`

Defined in: [src/intelligence/capability.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L248)

***

### AgentCandidateExperimentCellExecutionError

Defined in: [src/intelligence/improvement-cycle.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L142)

A failed baseline or candidate cell with its complete Runtime failure result.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new AgentCandidateExperimentCellExecutionError**(`finalization`): [`AgentCandidateExperimentCellExecutionError`](#agentcandidateexperimentcellexecutionerror)

Defined in: [src/intelligence/improvement-cycle.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L145)

###### Parameters

###### finalization

###### succeeded

`false`

###### reason

`string`

###### partial

\{ `executionId`: `string`; `bundleDigest`: `` `sha256:${string}` ``; `executionPlanDigest`: `` `sha256:${string}` ``; `materializationReceiptDigest`: `` `sha256:${string}` ``; `termination?`: `AgentCandidateTermination`; \}

###### partial.executionId

`string`

###### partial.bundleDigest

`` `sha256:${string}` ``

###### partial.executionPlanDigest

`` `sha256:${string}` ``

###### partial.materializationReceiptDigest

`` `sha256:${string}` ``

###### partial.termination?

`AgentCandidateTermination`

###### usage

`AgentCandidateFixedSpend` \| `null`

Independent evaluator-gateway usage, even when execution or trace capture failed.

###### Returns

[`AgentCandidateExperimentCellExecutionError`](#agentcandidateexperimentcellexecutionerror)

###### Overrides

`Error.constructor`

#### Properties

##### finalization

> `readonly` **finalization**: `object`

Defined in: [src/intelligence/improvement-cycle.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L143)

###### succeeded

> **succeeded**: `false`

###### reason

> **reason**: `string`

###### partial

> **partial**: `object`

###### partial.executionId

> **executionId**: `string`

###### partial.bundleDigest

> **bundleDigest**: `` `sha256:${string}` ``

###### partial.executionPlanDigest

> **executionPlanDigest**: `` `sha256:${string}` ``

###### partial.materializationReceiptDigest

> **materializationReceiptDigest**: `` `sha256:${string}` ``

###### partial.termination?

> `optional` **termination?**: `AgentCandidateTermination`

###### usage

> **usage**: `AgentCandidateFixedSpend` \| `null`

Independent evaluator-gateway usage, even when execution or trace capture failed.

## Interfaces

### CreateAgentImprovementActivationResultOptions

Defined in: [src/intelligence/activation.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L38)

#### Properties

##### completedAt

> **completedAt**: `string`

Defined in: [src/intelligence/activation.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L39)

##### outcome

> **outcome**: `AgentImprovementActivationOutcome`

Defined in: [src/intelligence/activation.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L40)

***

### AgentImprovementActivationTargetPlan

Defined in: [src/intelligence/activation.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L43)

#### Extends

- `AgentImprovementActivationTarget`

#### Properties

##### desiredDigest

> **desiredDigest**: `` `sha256:${string}` ``

Defined in: [src/intelligence/activation.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L44)

##### desiredInput

> **desiredInput**: `unknown`

Defined in: [src/intelligence/activation.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L50)

Exact measured input the product must apply to reach `desiredDigest`.
Transition surfaces such as code and knowledge are applied operations, so
their resulting state digest is not the digest of this input document.

***

### AgentProfileImprovementActivationTargetPlan

Defined in: [src/intelligence/activation.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L63)

#### Extends

- `AgentImprovementActivationTarget`

#### Properties

##### desiredDigest

> **desiredDigest**: `` `sha256:${string}` ``

Defined in: [src/intelligence/activation.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L65)

##### desiredInput

> **desiredInput**: [`AgentProfileImprovementActivationOperation`](#agentprofileimprovementactivationoperation)

Defined in: [src/intelligence/activation.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L66)

***

### SealedCandidateActivationTransitionInput

Defined in: [src/intelligence/activation.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L69)

#### Properties

##### kind

> **kind**: `"sealed-candidate"`

Defined in: [src/intelligence/activation.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L70)

##### activation

> **activation**: `AgentImprovementActivation`

Defined in: [src/intelligence/activation.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L71)

##### candidateBundle

> **candidateBundle**: `AgentCandidateBundle`

Defined in: [src/intelligence/activation.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L72)

##### bundle

> **bundle**: `AgentCandidateBundle`

Defined in: [src/intelligence/activation.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L73)

##### targets

> **targets**: \[[`AgentImprovementActivationTargetPlan`](#agentimprovementactivationtargetplan), `...AgentImprovementActivationTargetPlan[]`\]

Defined in: [src/intelligence/activation.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L74)

##### attemptedAt

> **attemptedAt**: `string`

Defined in: [src/intelligence/activation.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L75)

##### expired

> **expired**: `boolean`

Defined in: [src/intelligence/activation.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L76)

***

### ProfileImprovementActivationTransitionInput

Defined in: [src/intelligence/activation.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L83)

A measured profile change without raw profile bytes.
The product owns the private state lookup and atomic write.

#### Properties

##### kind

> **kind**: `"profile-improvement"`

Defined in: [src/intelligence/activation.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L84)

##### activation

> **activation**: `AgentImprovementActivation`

Defined in: [src/intelligence/activation.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L85)

##### experiment

> **experiment**: `AgentProfileImprovementExperiment`

Defined in: [src/intelligence/activation.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L86)

##### sourceStateDigest

> **sourceStateDigest**: `` `sha256:${string}` ``

Defined in: [src/intelligence/activation.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L87)

##### desiredStateDigest

> **desiredStateDigest**: `` `sha256:${string}` ``

Defined in: [src/intelligence/activation.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L88)

##### operation

> **operation**: [`AgentProfileImprovementActivationOperation`](#agentprofileimprovementactivationoperation)

Defined in: [src/intelligence/activation.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L89)

##### targets

> **targets**: \[[`AgentProfileImprovementActivationTargetPlan`](#agentprofileimprovementactivationtargetplan), `...AgentProfileImprovementActivationTargetPlan[]`\]

Defined in: [src/intelligence/activation.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L90)

##### attemptedAt

> **attemptedAt**: `string`

Defined in: [src/intelligence/activation.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L94)

##### expired

> **expired**: `boolean`

Defined in: [src/intelligence/activation.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L95)

***

### AgentImprovementActivationResultStore

Defined in: [src/intelligence/activation.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L102)

#### Methods

##### load()

> **load**(`idempotencyKey`): `Promise`\<`unknown`\>

Defined in: [src/intelligence/activation.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L103)

###### Parameters

###### idempotencyKey

`` `sha256:${string}` ``

###### Returns

`Promise`\<`unknown`\>

##### putIfAbsent()

> **putIfAbsent**(`result`): `Promise`\<`unknown`\>

Defined in: [src/intelligence/activation.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L104)

###### Parameters

###### result

`AgentImprovementActivationResult`

###### Returns

`Promise`\<`unknown`\>

***

### ExecuteAgentImprovementActivationInput

Defined in: [src/intelligence/activation.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L129)

#### Properties

##### proposal

> **proposal**: `AgentImprovementProposal`

Defined in: [src/intelligence/activation.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L130)

##### review

> **review**: `AgentImprovementReview`

Defined in: [src/intelligence/activation.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L131)

##### activation

> **activation**: `AgentImprovementActivation`

Defined in: [src/intelligence/activation.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L132)

***

### ExecuteAgentImprovementActivationOptions

Defined in: [src/intelligence/activation.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L135)

#### Properties

##### transition

> **transition**: [`AgentImprovementActivationTransition`](#agentimprovementactivationtransition)

Defined in: [src/intelligence/activation.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L136)

##### reconcile?

> `optional` **reconcile?**: [`AgentImprovementActivationReconciliation`](#agentimprovementactivationreconciliation)

Defined in: [src/intelligence/activation.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L137)

##### now?

> `optional` **now?**: () => `Date`

Defined in: [src/intelligence/activation.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L138)

###### Returns

`Date`

***

### CredentialRef

Defined in: [src/intelligence/capability.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L72)

A named secret a binding requires — declared, never carried.

#### Properties

##### key

> **key**: `string`

Defined in: [src/intelligence/capability.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L73)

***

### HostSpec

Defined in: [src/intelligence/capability.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L95)

The host a `process-on-infra` binding provisions before its inner binding.
Reuses `createExecutor`'s backend-as-data vocabulary — no new runtime invented.
`image` is the sandbox image tag; `warm`/`idleTtlMs`/`costTag` meter standing
cost; `ports` are the inner server's listen ports the host must expose.

#### Properties

##### backend

> **backend**: `"router"` \| `"sandbox"` \| `"cli"`

Defined in: [src/intelligence/capability.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L96)

##### image?

> `optional` **image?**: `string`

Defined in: [src/intelligence/capability.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L97)

##### ports?

> `optional` **ports?**: `number`[]

Defined in: [src/intelligence/capability.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L98)

##### warm?

> `optional` **warm?**: `boolean`

Defined in: [src/intelligence/capability.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L99)

##### idleTtlMs?

> `optional` **idleTtlMs?**: `number`

Defined in: [src/intelligence/capability.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L100)

##### costTag?

> `optional` **costTag?**: `string`

Defined in: [src/intelligence/capability.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L101)

***

### CertProvenance

Defined in: [src/intelligence/capability.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L155)

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

Defined in: [src/intelligence/capability.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L156)

##### version

> **version**: `number` \| `null`

Defined in: [src/intelligence/capability.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L157)

##### lift

> **lift**: `string` \| `null`

Defined in: [src/intelligence/capability.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L158)

##### promotedAt

> **promotedAt**: `string`

Defined in: [src/intelligence/capability.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L159)

##### sourcePath

> **sourcePath**: `string` \| `null`

Defined in: [src/intelligence/capability.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L160)

***

### CertifiedCapability

Defined in: [src/intelligence/capability.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L164)

One certified unit of agent power.

#### Properties

##### id

> **id**: `string`

Defined in: [src/intelligence/capability.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L165)

##### iface

> **iface**: [`CapabilityInterface`](#capabilityinterface)

Defined in: [src/intelligence/capability.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L166)

##### binding

> **binding**: [`DeliveryBinding`](#deliverybinding)

Defined in: [src/intelligence/capability.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L167)

##### auth

> **auth**: [`CapabilityAuth`](#capabilityauth)

Defined in: [src/intelligence/capability.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L168)

##### provenance

> **provenance**: [`CertProvenance`](#certprovenance)

Defined in: [src/intelligence/capability.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L169)

***

### CapabilityManifest

Defined in: [src/intelligence/capability.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L177)

The strict generalization of `CertifiedProfile`. `promptSurface` is kept
during the migration window (the shipped pull lane still emits it); new
capabilities live in `capabilities`.

#### Properties

##### target

> **target**: `string`

Defined in: [src/intelligence/capability.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L178)

##### generatedAt

> **generatedAt**: `string`

Defined in: [src/intelligence/capability.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L179)

##### promptSurface

> **promptSurface**: [`CertifiedPromptSurface`](#certifiedpromptsurface) \| `null`

Defined in: [src/intelligence/capability.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L180)

##### capabilities

> **capabilities**: [`CertifiedCapability`](#certifiedcapability)[]

Defined in: [src/intelligence/capability.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L181)

***

### ResolvedRetrieval

Defined in: [src/intelligence/capability.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L187)

One retrieval handle. The agent never learns vector vs graph vs index.

#### Properties

##### name

> **name**: `string`

Defined in: [src/intelligence/capability.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L188)

#### Methods

##### retrieve()

> **retrieve**(`query`, `k?`): `Promise`\<`object`[]\>

Defined in: [src/intelligence/capability.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L189)

###### Parameters

###### query

`string`

###### k?

`number`

###### Returns

`Promise`\<`object`[]\>

***

### ResolvedHook

Defined in: [src/intelligence/capability.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L194)

One resolved hook — event + the command/matcher the seam folds into
 `AgentProfile.hooks`.

#### Properties

##### event

> **event**: `string`

Defined in: [src/intelligence/capability.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L195)

##### command

> **command**: `string`

Defined in: [src/intelligence/capability.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L196)

##### matcher?

> `optional` **matcher?**: `string`

Defined in: [src/intelligence/capability.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L197)

***

### ResolvedSubagent

Defined in: [src/intelligence/capability.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L201)

One resolved subagent — folded into `AgentProfile.subagents`.

#### Properties

##### name

> **name**: `string`

Defined in: [src/intelligence/capability.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L202)

##### description?

> `optional` **description?**: `string`

Defined in: [src/intelligence/capability.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L203)

##### prompt?

> `optional` **prompt?**: `string`

Defined in: [src/intelligence/capability.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L204)

***

### ResolvedSurface

Defined in: [src/intelligence/capability.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L213)

What `composeCertifiedProfile` produces. Every binding fans into the same
slots, consumed identically by the in-process seam (`RouterToolsSeam.{tools,
executeToolCall}` + folded prompt) and the sandbox seam (`AgentProfile`).
`dispose()` tears provisioned hosts down in REVERSE dependency order.

#### Properties

##### tools

> **tools**: [`ToolSpec`](runtime.md#toolspec)[]

Defined in: [src/intelligence/capability.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L215)

Host-side tool defs → `RouterToolsSeam.tools` / agent-app `extraTools`.

##### mcpConnections

> **mcpConnections**: `Record`\<`string`, `AgentProfileMcpServer`\>

Defined in: [src/intelligence/capability.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L220)

Sandbox-side tool delivery → `AgentProfile.mcp` / in-proc `createMcpEnvironment`.

##### promptAdditions

> **promptAdditions**: `string`[]

Defined in: [src/intelligence/capability.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L222)

Prompt-context additions, byte-stable-ordered → folded system prompt.

##### files

> **files**: `object`[]

Defined in: [src/intelligence/capability.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L224)

Workspace files → `AgentProfile.resources.files`.

###### path

> **path**: `string`

###### content

> **content**: `string`

###### executable?

> `optional` **executable?**: `boolean`

##### retrieval

> **retrieval**: [`ResolvedRetrieval`](#resolvedretrieval)[]

Defined in: [src/intelligence/capability.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L226)

Uniform retrieval handles.

##### hooks

> **hooks**: [`ResolvedHook`](#resolvedhook)[]

Defined in: [src/intelligence/capability.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L228)

Hooks → `AgentProfile.hooks`.

##### subagents

> **subagents**: [`ResolvedSubagent`](#resolvedsubagent)[]

Defined in: [src/intelligence/capability.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L230)

Subagents → `AgentProfile.subagents`.

##### systemPrompt

> **systemPrompt**: `string`

Defined in: [src/intelligence/capability.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L233)

The folded system prompt — base + the byte-stable prompt additions, exactly
 as `composeCertifiedPrompt` renders the inline/context capabilities.

#### Methods

##### execute()

> **execute**(`name`, `args`, `task`): `Promise`\<`string`\>

Defined in: [src/intelligence/capability.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L218)

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

Defined in: [src/intelligence/capability.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L235)

Tear down provisioned hosts (reverse dependency order).

###### Returns

`Promise`\<`void`\>

***

### CertifiedArtifact

Defined in: [src/intelligence/delivery.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L40)

A promoted, certified artifact (one entry in the composed profile).

#### Properties

##### path

> **path**: `string` \| `null`

Defined in: [src/intelligence/delivery.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L41)

##### content

> **content**: `string`

Defined in: [src/intelligence/delivery.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L42)

##### contentHash

> **contentHash**: `string`

Defined in: [src/intelligence/delivery.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L43)

##### version

> **version**: `number` \| `null`

Defined in: [src/intelligence/delivery.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L44)

##### lift

> **lift**: `string` \| `null`

Defined in: [src/intelligence/delivery.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L47)

Held-out gate lift attached at certification, e.g. "+3.1pp" — never a
 within-run claim. `null` when the promotion carried no lift record.

##### promotedAt

> **promotedAt**: `string`

Defined in: [src/intelligence/delivery.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L48)

***

### CertifiedPromptSurface

Defined in: [src/intelligence/delivery.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L52)

The active promoted prompt surface for a target.

#### Properties

##### surface

> **surface**: `string`

Defined in: [src/intelligence/delivery.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L53)

##### surfaceHash

> **surfaceHash**: `string`

Defined in: [src/intelligence/delivery.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L54)

##### version

> **version**: `number` \| `null`

Defined in: [src/intelligence/delivery.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L55)

##### lift

> **lift**: `string` \| `null`

Defined in: [src/intelligence/delivery.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L56)

***

### DiffProvenance

Defined in: [src/intelligence/delivery.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L61)

The held-out provenance the plane's certify step stamps on a promoted diff.
 `lift` is the held-out gate lift (e.g. "+3.1pp"), never a within-run claim.

#### Properties

##### version

> **version**: `number` \| `null`

Defined in: [src/intelligence/delivery.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L62)

##### lift

> **lift**: `string` \| `null`

Defined in: [src/intelligence/delivery.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L63)

##### contentHash

> **contentHash**: `string`

Defined in: [src/intelligence/delivery.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L64)

##### promotedAt

> **promotedAt**: `string`

Defined in: [src/intelligence/delivery.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L65)

***

### ProposedProfileDiff

Defined in: [src/intelligence/delivery.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L75)

A gate-certified profile diff the plane has already promoted, plus the
held-out provenance it carries. This is the previously-DROPPED typed diff the
composed endpoint returns; `withIntelligence` deserializes it and surfaces it
as a PROPOSAL — a human, or the gated local `improve()` loop, turns a proposal
into a shipped profile. It is NEVER auto-applied at runtime.

#### Properties

##### diff

> **diff**: `AgentProfileDiff`

Defined in: [src/intelligence/delivery.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L76)

##### provenance

> **provenance**: [`DiffProvenance`](#diffprovenance)

Defined in: [src/intelligence/delivery.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L77)

***

### CertifiedCapabilitySummary

Defined in: [src/intelligence/delivery.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L83)

The composed endpoint's per-capability summary — the narrow shape on the
 wire (id + surface + path/content + provenance). Distinct from the richer
 `CertifiedCapability` the capability resolver lowers a manifest into.

#### Properties

##### id

> **id**: `string`

Defined in: [src/intelligence/delivery.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L84)

##### iface

> **iface**: `object`

Defined in: [src/intelligence/delivery.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L85)

###### surface

> **surface**: `string`

##### binding

> **binding**: `object`

Defined in: [src/intelligence/delivery.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L86)

###### path

> **path**: `string` \| `null`

###### content

> **content**: `string`

##### provenance

> **provenance**: [`DiffProvenance`](#diffprovenance)

Defined in: [src/intelligence/delivery.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L87)

***

### CertifiedProfile

Defined in: [src/intelligence/delivery.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L92)

The composed certified profile — exactly the shape the plane's
 `GET /v1/profiles/:target/composed` returns.

#### Properties

##### target

> **target**: `string`

Defined in: [src/intelligence/delivery.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L93)

##### generatedAt

> **generatedAt**: `string`

Defined in: [src/intelligence/delivery.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L94)

##### promptSurface

> **promptSurface**: [`CertifiedPromptSurface`](#certifiedpromptsurface) \| `null`

Defined in: [src/intelligence/delivery.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L95)

##### artifacts

> **artifacts**: `Record`\<`string`, [`CertifiedArtifact`](#certifiedartifact)[]\>

Defined in: [src/intelligence/delivery.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L96)

##### agentProfileDiffs

> **agentProfileDiffs**: [`ProposedProfileDiff`](#proposedprofilediff)[]

Defined in: [src/intelligence/delivery.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L99)

The typed profile diffs the plane has promoted, each with held-out
 provenance. Surfaced as proposals; never auto-applied. Empty when none.

##### capabilities

> **capabilities**: [`CertifiedCapabilitySummary`](#certifiedcapabilitysummary)[]

Defined in: [src/intelligence/delivery.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L101)

The composed capability summaries the plane returns. Empty when none.

##### agentProfile

> **agentProfile**: `AgentProfile` \| `null`

Defined in: [src/intelligence/delivery.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L104)

The composed profile the promoted diffs fold to, for inspection. `null`
 when no diffs are promoted.

***

### PullCertifiedOptions

Defined in: [src/intelligence/delivery.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L113)

#### Extended by

- [`CertifiedPromptSourceOptions`](#certifiedpromptsourceoptions)

#### Properties

##### target

> **target**: `string`

Defined in: [src/intelligence/delivery.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L115)

The agent target certified artifacts are promoted under.

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [src/intelligence/delivery.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L117)

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [src/intelligence/delivery.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L120)

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [src/intelligence/delivery.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L122)

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

Defined in: [src/intelligence/delivery.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L124)

Abort the request after this many ms. Default 10000.

***

### SubmitAgentImprovementProposalOptions

Defined in: [src/intelligence/delivery.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L134)

Submit a completed measured proposal for product-side review.

#### Properties

##### proposal

> **proposal**: `AgentImprovementProposal`

Defined in: [src/intelligence/delivery.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L135)

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [src/intelligence/delivery.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L137)

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [src/intelligence/delivery.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L140)

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
`https://intelligence.tangle.tools`.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [src/intelligence/delivery.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L142)

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

Defined in: [src/intelligence/delivery.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L144)

Abort the request after this many ms. Default 10000.

***

### CertifiedPromptSource

Defined in: [src/intelligence/delivery.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L444)

A cached, self-refreshing source of a target's certified prompt additions —
 the prompt-only delivery lane for callers that assemble their OWN system
 prompt (product chat routes) rather than wrapping an agent fn. Same
 fail-closed semantics as [pullCertified](#pullcertified): pulls at most every
 `refreshMs`, coalesces concurrent pulls, keeps the last-known profile on a
 failed/404 pull, never throws, never blocks past the pull timeout.

#### Methods

##### compose()

> **compose**(`base`): `Promise`\<`string`\>

Defined in: [src/intelligence/delivery.ts:447](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L447)

Refresh (window-respecting) then fold the certified additions into a
 base system prompt. Returns `base` unchanged when nothing is promoted.

###### Parameters

###### base

`string`

###### Returns

`Promise`\<`string`\>

##### current()

> **current**(): [`CertifiedProfile`](#certifiedprofile) \| `null`

Defined in: [src/intelligence/delivery.ts:449](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L449)

The certified profile currently in effect (`null` = none pulled yet).

###### Returns

[`CertifiedProfile`](#certifiedprofile) \| `null`

##### refresh()

> **refresh**(): `Promise`\<`void`\>

Defined in: [src/intelligence/delivery.ts:451](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L451)

Pull now if the refresh window has elapsed; coalesced and fail-closed.

###### Returns

`Promise`\<`void`\>

***

### CertifiedPromptSourceOptions

Defined in: [src/intelligence/delivery.ts:456](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L456)

Options for [createCertifiedPromptSource](#createcertifiedpromptsource) — the pull coordinates plus
 the refresh cadence.

#### Extends

- [`PullCertifiedOptions`](#pullcertifiedoptions)

#### Properties

##### target

> **target**: `string`

Defined in: [src/intelligence/delivery.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L115)

The agent target certified artifacts are promoted under.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`target`](#target-2)

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [src/intelligence/delivery.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L117)

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`apiKey`](#apikey)

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [src/intelligence/delivery.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L120)

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`baseUrl`](#baseurl)

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [src/intelligence/delivery.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L122)

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

Defined in: [src/intelligence/delivery.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L124)

Abort the request after this many ms. Default 10000.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`timeoutMs`](#timeoutms)

##### refreshMs?

> `optional` **refreshMs?**: `number`

Defined in: [src/intelligence/delivery.ts:458](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L458)

Min interval between certified-profile pulls. Default 5m.

***

### EffortSettings

Defined in: [src/intelligence/effort.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L32)

The flat, resolved settings a tier compiles to. Every field is individually
overridable through `resolveEffort`. Pure data — read by the wrapper, never
self-executing.

#### Properties

##### analysts

> **analysts**: `boolean`

Defined in: [src/intelligence/effort.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L34)

Whether trace-derived analyst diagnosis may spawn. `false` ⇒ no analyst.

##### corpus

> **corpus**: [`CorpusAccess`](#corpusaccess)

Defined in: [src/intelligence/effort.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L36)

Cross-run corpus access this tier permits.

##### fanout

> **fanout**: `number`

Defined in: [src/intelligence/effort.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L38)

Parallel candidate width. `1` ⇒ single-shot, no breadth.

##### loops

> **loops**: `boolean`

Defined in: [src/intelligence/effort.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L40)

Whether multi-step improvement loops (refine / fanout-vote) may run.

##### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Defined in: [src/intelligence/effort.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L47)

Ceiling, in USD, for INTELLIGENCE-class spawns only (analysts, corpus,
loops) — NOT base inference. `0` refuses every intelligence spawn; `null`
means uncapped (the spend lands on the Pareto receipt). Base-stream
inference is billed on its own channel and is never constrained here.

***

### EffortOverridesCompiled

Defined in: [src/intelligence/effort.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L157)

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

Defined in: [src/intelligence/effort.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L159)

Construct + pass a `ScopeAnalyst`? `false` ⇒ omit it (degrade to the base agent).

##### fanout

> **fanout**: `number`

Defined in: [src/intelligence/effort.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L161)

`ShapeBudget.fanout` width to pass to `runPersonified`.

##### withLoops

> **withLoops**: `boolean`

Defined in: [src/intelligence/effort.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L163)

Run the multi-step improvement cycle, or no-op it for this run?

##### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Defined in: [src/intelligence/effort.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L165)

Intelligence-class spend ceiling. `0` refuses every intelligence spawn; `null` uncapped.

***

### CreateExactProcessCandidateExperimentExecutorOptions

Defined in: [src/intelligence/exact-process-candidate.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L45)

#### Properties

##### provider

> **provider**: [`AgentEnvironmentProviderRef`](runtime/environment-provider.md#agentenvironmentproviderref)

Defined in: [src/intelligence/exact-process-candidate.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L46)

##### providerRegistry?

> `optional` **providerRegistry?**: [`AgentEnvironmentProviderRegistry`](runtime/environment-provider.md#agentenvironmentproviderregistry)

Defined in: [src/intelligence/exact-process-candidate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L47)

##### resources

> **resources**: `AgentExactProcessResources`

Defined in: [src/intelligence/exact-process-candidate.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L48)

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

Defined in: [src/intelligence/exact-process-candidate.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L49)

##### provisionTimeoutMs?

> `optional` **provisionTimeoutMs?**: `number`

Defined in: [src/intelligence/exact-process-candidate.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L50)

##### recoveryRetentionMs?

> `optional` **recoveryRetentionMs?**: `number`

Defined in: [src/intelligence/exact-process-candidate.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L51)

##### ports

> **ports**: [`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports)

Defined in: [src/intelligence/exact-process-candidate.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L52)

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](index.md#agentcandidatebenchmarkgraderport)

Defined in: [src/intelligence/exact-process-candidate.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L53)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](index.md#agentcandidateoutputartifactport)

Defined in: [src/intelligence/exact-process-candidate.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L54)

##### traceStore

> **traceStore**: `TraceStore`

Defined in: [src/intelligence/exact-process-candidate.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L55)

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](index.md#agentcandidateexecutionclaimstore)

Defined in: [src/intelligence/exact-process-candidate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L56)

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [src/intelligence/exact-process-candidate.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L57)

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Defined in: [src/intelligence/exact-process-candidate.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L58)

***

### CreateProtectedExactProcessCandidateExperimentExecutorOptions

Defined in: [src/intelligence/exact-process-candidate.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L68)

Builds the standard exact-process executor with model access that is scoped,
metered, and settled by the caller's grant service.

#### Extends

- `Omit`\<[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions), `"ports"`\>

#### Properties

##### provider

> **provider**: [`AgentEnvironmentProviderRef`](runtime/environment-provider.md#agentenvironmentproviderref)

Defined in: [src/intelligence/exact-process-candidate.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L46)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`provider`](#provider)

##### providerRegistry?

> `optional` **providerRegistry?**: [`AgentEnvironmentProviderRegistry`](runtime/environment-provider.md#agentenvironmentproviderregistry)

Defined in: [src/intelligence/exact-process-candidate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L47)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`providerRegistry`](#providerregistry)

##### resources

> **resources**: `AgentExactProcessResources`

Defined in: [src/intelligence/exact-process-candidate.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L48)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`resources`](#resources)

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

Defined in: [src/intelligence/exact-process-candidate.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L49)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`providerOptions`](#provideroptions)

##### provisionTimeoutMs?

> `optional` **provisionTimeoutMs?**: `number`

Defined in: [src/intelligence/exact-process-candidate.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L50)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`provisionTimeoutMs`](#provisiontimeoutms)

##### recoveryRetentionMs?

> `optional` **recoveryRetentionMs?**: `number`

Defined in: [src/intelligence/exact-process-candidate.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L51)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`recoveryRetentionMs`](#recoveryretentionms)

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](index.md#agentcandidatebenchmarkgraderport)

Defined in: [src/intelligence/exact-process-candidate.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L53)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`grader`](#grader)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](index.md#agentcandidateoutputartifactport)

Defined in: [src/intelligence/exact-process-candidate.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L54)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`outputArtifacts`](#outputartifacts)

##### traceStore

> **traceStore**: `TraceStore`

Defined in: [src/intelligence/exact-process-candidate.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L55)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`traceStore`](#tracestore)

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](index.md#agentcandidateexecutionclaimstore)

Defined in: [src/intelligence/exact-process-candidate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L56)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`claimStore`](#claimstore)

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [src/intelligence/exact-process-candidate.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L57)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`cleanupTimeoutMs`](#cleanuptimeoutms)

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Defined in: [src/intelligence/exact-process-candidate.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L58)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`resultTimeoutMs`](#resulttimeoutms)

##### hostPorts

> **hostPorts**: [`AgentCandidateExecutionHostPorts`](#agentcandidateexecutionhostports)

Defined in: [src/intelligence/exact-process-candidate.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L70)

##### model

> **model**: [`CreateProtectedAgentCandidateModelPortOptions`](index.md#createprotectedagentcandidatemodelportoptions)

Defined in: [src/intelligence/exact-process-candidate.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L71)

***

### ExactProcessCandidateExperimentExecution

Defined in: [src/intelligence/exact-process-candidate.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L74)

#### Extends

- `CandidateExperimentExecutionInput`

#### Properties

##### executionId

> **executionId**: `string`

Defined in: [src/intelligence/exact-process-candidate.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L76)

##### attempt?

> `optional` **attempt?**: `number`

Defined in: [src/intelligence/exact-process-candidate.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L77)

##### executionRoots

> **executionRoots**: `object`

Defined in: [src/intelligence/exact-process-candidate.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L78)

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### stagingRoots

> **stagingRoots**: `object`

Defined in: [src/intelligence/exact-process-candidate.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L79)

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

Defined in: [src/intelligence/exact-process-candidate.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L80)

***

### ExactProcessCandidateExperimentExecutor

Defined in: [src/intelligence/exact-process-candidate.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L83)

#### Extended by

- [`ProtectedExactProcessCandidateExperimentExecutor`](#protectedexactprocesscandidateexperimentexecutor)

#### Properties

##### executor

> `readonly` **executor**: [`AgentCandidateExecutorPort`](index.md#agentcandidateexecutorport)

Defined in: [src/intelligence/exact-process-candidate.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L85)

Runtime's expired-attempt path reuses this port only to stop and dispose.

#### Methods

##### execute()

> **execute**(`input`): `Promise`\<`CandidateExecutionEvidence`\>

Defined in: [src/intelligence/exact-process-candidate.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L86)

###### Parameters

###### input

[`ExactProcessCandidateExperimentExecution`](#exactprocesscandidateexperimentexecution)

###### Returns

`Promise`\<`CandidateExecutionEvidence`\>

***

### ProtectedExactProcessCandidateExperimentExecutor

Defined in: [src/intelligence/exact-process-candidate.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L90)

Exact-process executor plus the ports required for durable recovery.

#### Extends

- [`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor)

#### Properties

##### executor

> `readonly` **executor**: [`AgentCandidateExecutorPort`](index.md#agentcandidateexecutorport)

Defined in: [src/intelligence/exact-process-candidate.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L85)

Runtime's expired-attempt path reuses this port only to stop and dispose.

###### Inherited from

[`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor).[`executor`](#executor)

##### recoveryPorts

> `readonly` **recoveryPorts**: `Pick`\<[`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports), `"models"` \| `"memory"`\>

Defined in: [src/intelligence/exact-process-candidate.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L92)

#### Methods

##### execute()

> **execute**(`input`): `Promise`\<`CandidateExecutionEvidence`\>

Defined in: [src/intelligence/exact-process-candidate.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L86)

###### Parameters

###### input

[`ExactProcessCandidateExperimentExecution`](#exactprocesscandidateexperimentexecution)

###### Returns

`Promise`\<`CandidateExecutionEvidence`\>

###### Inherited from

[`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor).[`execute`](#execute-1)

***

### AgentCandidateExperimentCellPlacement

Defined in: [src/intelligence/improvement-cycle.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L102)

#### Extended by

- [`ExecuteAgentCandidateExperimentCellOptions`](#executeagentcandidateexperimentcelloptions)

#### Properties

##### executionId

> **executionId**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L103)

##### attempt?

> `optional` **attempt?**: `number`

Defined in: [src/intelligence/improvement-cycle.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L104)

##### executionRoots

> **executionRoots**: `object`

Defined in: [src/intelligence/improvement-cycle.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L105)

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### stagingRoots

> **stagingRoots**: `object`

Defined in: [src/intelligence/improvement-cycle.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L106)

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

##### ports

> **ports**: [`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports)

Defined in: [src/intelligence/improvement-cycle.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L107)

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

Defined in: [src/intelligence/improvement-cycle.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L108)

##### execution

> **execution**: [`ExecutePreparedAgentCandidateOptions`](index.md#executepreparedagentcandidateoptions)

Defined in: [src/intelligence/improvement-cycle.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L109)

***

### RunAgentCandidateExperimentOptions

Defined in: [src/intelligence/improvement-cycle.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L112)

#### Extends

- `Omit`\<`CompareCandidateExperimentOptions`, `"experiment"` \| `"measurements"`\>

#### Properties

##### experiment

> **experiment**: `AgentCandidateExperiment`

Defined in: [src/intelligence/improvement-cycle.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L114)

##### placeCell

> **placeCell**: (`input`) => [`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

Defined in: [src/intelligence/improvement-cycle.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L115)

###### Parameters

###### input

`CandidateExperimentExecutionInput`

###### Returns

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [src/intelligence/improvement-cycle.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L118)

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/intelligence/improvement-cycle.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L119)

***

### RunAgentCandidateExperimentResult

Defined in: [src/intelligence/improvement-cycle.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L122)

#### Properties

##### experiment

> **experiment**: `AgentCandidateExperiment`

Defined in: [src/intelligence/improvement-cycle.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L123)

##### measurements

> **measurements**: `AgentCandidateExperimentMeasurement`[]

Defined in: [src/intelligence/improvement-cycle.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L124)

##### evaluation

> **evaluation**: `AgentImprovementMeasuredComparison`

Defined in: [src/intelligence/improvement-cycle.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L125)

***

### ExecuteAgentCandidateExperimentCellOptions

Defined in: [src/intelligence/improvement-cycle.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L128)

#### Extends

- `CandidateExperimentExecutionInput`.[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)

#### Properties

##### executionId

> **executionId**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L103)

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`executionId`](#executionid-1)

##### attempt?

> `optional` **attempt?**: `number`

Defined in: [src/intelligence/improvement-cycle.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L104)

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`attempt`](#attempt-1)

##### executionRoots

> **executionRoots**: `object`

Defined in: [src/intelligence/improvement-cycle.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L105)

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`executionRoots`](#executionroots-1)

##### stagingRoots

> **stagingRoots**: `object`

Defined in: [src/intelligence/improvement-cycle.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L106)

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`stagingRoots`](#stagingroots-1)

##### ports

> **ports**: [`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports)

Defined in: [src/intelligence/improvement-cycle.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L107)

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`ports`](#ports-2)

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

Defined in: [src/intelligence/improvement-cycle.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L108)

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`preparation`](#preparation-1)

##### execution

> **execution**: [`ExecutePreparedAgentCandidateOptions`](index.md#executepreparedagentcandidateoptions)

Defined in: [src/intelligence/improvement-cycle.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L109)

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`execution`](#execution)

***

### VerifyCandidateExecutionEvidenceOptions

Defined in: [src/intelligence/improvement-cycle.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L132)

#### Properties

##### experiment

> **experiment**: `AgentCandidateExperiment`

Defined in: [src/intelligence/improvement-cycle.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L133)

##### arm

> **arm**: `"candidate"` \| `"baseline"`

Defined in: [src/intelligence/improvement-cycle.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L134)

##### benchmarkCell

> **benchmarkCell**: `AgentCandidateBenchmarkCellRef`

Defined in: [src/intelligence/improvement-cycle.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L135)

##### seed

> **seed**: `number`

Defined in: [src/intelligence/improvement-cycle.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L136)

##### attempt?

> `optional` **attempt?**: `number`

Defined in: [src/intelligence/improvement-cycle.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L137)

##### resolvedResources?

> `optional` **resolvedResources?**: `ReadonlyMap`\<`` `sha256:${string}` ``, `string`\>

Defined in: [src/intelligence/improvement-cycle.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L138)

***

### CreateAgentImprovementProposalOptions

Defined in: [src/intelligence/improvement-cycle.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L152)

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L153)

##### findings

> **findings**: readonly `AnalystFinding`[]

Defined in: [src/intelligence/improvement-cycle.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L154)

##### evaluation

> **evaluation**: `AgentImprovementEvaluation`

Defined in: [src/intelligence/improvement-cycle.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L155)

##### now?

> `optional` **now?**: () => `Date`

Defined in: [src/intelligence/improvement-cycle.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L156)

###### Returns

`Date`

***

### ReviewAgentImprovementInput

Defined in: [src/intelligence/improvement-cycle.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L161)

#### Properties

##### decision

> **decision**: `AgentImprovementReviewDecision`

Defined in: [src/intelligence/improvement-cycle.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L162)

##### reviewedBy

> **reviewedBy**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L163)

##### reason

> **reason**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L164)

##### feedback?

> `optional` **feedback?**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L165)

##### now?

> `optional` **now?**: () => `Date`

Defined in: [src/intelligence/improvement-cycle.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L166)

###### Returns

`Date`

***

### CreateAgentImprovementActivationOptions

Defined in: [src/intelligence/improvement-cycle.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L169)

#### Properties

##### intent

> **intent**: `AgentImprovementActivationIntent`

Defined in: [src/intelligence/improvement-cycle.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L170)

##### targets

> **targets**: \[[`AgentImprovementActivationTargetIdentity`](#agentimprovementactivationtargetidentity), `...AgentImprovementActivationTargetIdentity[]`\]

Defined in: [src/intelligence/improvement-cycle.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L172)

Runtime derives each exact source digest; callers identify only the records to change.

##### fundingOwner

> **fundingOwner**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L173)

##### authorizedBy

> **authorizedBy**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L174)

##### expiresAt

> **expiresAt**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L175)

##### now?

> `optional` **now?**: () => `Date`

Defined in: [src/intelligence/improvement-cycle.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L176)

###### Returns

`Date`

***

### ProposeAgentImprovementOptions

Defined in: [src/intelligence/improvement-cycle.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L179)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/intelligence/improvement-cycle.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L180)

##### profile

> **profile**: `AgentProfile`

Defined in: [src/intelligence/improvement-cycle.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L181)

##### analysis

> **analysis**: `Omit`\<[`RunAnalystLoopOpts`](analyst-loop.md#runanalystloopopts), `"runId"` \| `"improvementProposalSource"`\>

Defined in: [src/intelligence/improvement-cycle.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L182)

##### improvement

> **improvement**: [`ImproveOptions`](index.md#improveoptions)\<`TScenario`, `TArtifact`\>

Defined in: [src/intelligence/improvement-cycle.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L183)

##### buildExperiment

> **buildExperiment**: (`input`) => [`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial) \| `Promise`\<[`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial)\>

Defined in: [src/intelligence/improvement-cycle.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L184)

###### Parameters

###### input

###### analysis

[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)

###### improvement

[`ImproveResult`](index.md#improveresult)\<`TScenario`, `TArtifact`\>

###### Returns

[`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial) \| `Promise`\<[`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial)\>

##### placeCell

> **placeCell**: (`input`) => [`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

Defined in: [src/intelligence/improvement-cycle.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L188)

###### Parameters

###### input

`CandidateExperimentExecutionInput`

###### Returns

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [src/intelligence/improvement-cycle.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L189)

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/intelligence/improvement-cycle.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L190)

##### candidate?

> `optional` **candidate?**: `object`

Defined in: [src/intelligence/improvement-cycle.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L191)

##### metadata?

> `optional` **metadata?**: `object`

Defined in: [src/intelligence/improvement-cycle.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L192)

###### Index Signature

\[`key`: `string`\]: `AgentCandidateJsonValue`

##### now?

> `optional` **now?**: () => `Date`

Defined in: [src/intelligence/improvement-cycle.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L193)

###### Returns

`Date`

***

### ProposeAgentImprovementResult

Defined in: [src/intelligence/improvement-cycle.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L202)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### analysis

> **analysis**: [`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)

Defined in: [src/intelligence/improvement-cycle.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L203)

##### improvement

> **improvement**: [`ImproveResult`](index.md#improveresult)\<`TScenario`, `TArtifact`\>

Defined in: [src/intelligence/improvement-cycle.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L204)

##### experiment

> **experiment**: `AgentCandidateExperiment`

Defined in: [src/intelligence/improvement-cycle.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L205)

##### measurements

> **measurements**: `AgentCandidateExperimentMeasurement`[]

Defined in: [src/intelligence/improvement-cycle.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L206)

##### proposal

> **proposal**: `AgentImprovementProposal`

Defined in: [src/intelligence/improvement-cycle.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L207)

***

### AgentImprovementTargetProfileDiffOptions

Defined in: [src/intelligence/improvement-surfaces.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L52)

#### Properties

##### id

> **id**: `string`

Defined in: [src/intelligence/improvement-surfaces.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L53)

##### source?

> `optional` **source?**: `object`

Defined in: [src/intelligence/improvement-surfaces.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L54)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [src/intelligence/improvement-surfaces.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L55)

***

### UsageSplit

Defined in: [src/intelligence/index.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L232)

The per-class cost split carried by every trace and outcome. `off` ⇒
`intelligenceUsd: 0` by construction — there is no intelligence spawn to
bill. This is a classification on the trace, NOT a budget-pool split.

#### Properties

##### inferenceUsd

> **inferenceUsd**: `number`

Defined in: [src/intelligence/index.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L234)

Base-stream (model) spend in USD.

##### intelligenceUsd

> **intelligenceUsd**: `number`

Defined in: [src/intelligence/index.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L236)

Intelligence-spawn spend in USD. Provably `0` at the OFF tier.

***

### RunRecord

Defined in: [src/intelligence/index.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L246)

The typed record `withIntelligence` sends per call — serialized through the
shipped OTLP builders to the plane's `/v1/otlp` ingest. `input`/`output` are
redacted on export; the per-class `usage` split carries the billing proof;
`loopEvents`, when present, export as the nested loop→round→iteration span
tree under the same `traceId`.

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/intelligence/index.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L247)

##### traceId

> **traceId**: `string`

Defined in: [src/intelligence/index.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L248)

##### project

> **project**: `string`

Defined in: [src/intelligence/index.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L249)

##### target

> **target**: `string`

Defined in: [src/intelligence/index.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L250)

##### input

> **input**: `unknown`

Defined in: [src/intelligence/index.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L251)

##### output

> **output**: `unknown`

Defined in: [src/intelligence/index.ts:252](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L252)

##### outcome

> **outcome**: `object`

Defined in: [src/intelligence/index.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L253)

###### success?

> `optional` **success?**: `boolean`

###### score?

> `optional` **score?**: `number`

###### usage

> **usage**: [`UsageSplit`](#usagesplit)

##### model?

> `optional` **model?**: `string`

Defined in: [src/intelligence/index.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L258)

##### provider?

> `optional` **provider?**: `string`

Defined in: [src/intelligence/index.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L259)

##### loopEvents?

> `optional` **loopEvents?**: [`LoopTraceEvent`](runtime.md#looptraceevent)[]

Defined in: [src/intelligence/index.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L260)

##### runtimeEvents?

> `optional` **runtimeEvents?**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

Defined in: [src/intelligence/index.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L261)

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [src/intelligence/index.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L262)

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [src/intelligence/index.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L263)

##### harness?

> `optional` **harness?**: `string`

Defined in: [src/intelligence/index.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L264)

##### repository?

> `optional` **repository?**: `string`

Defined in: [src/intelligence/index.ts:265](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L265)

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: [src/intelligence/index.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L266)

##### timing?

> `optional` **timing?**: `object`

Defined in: [src/intelligence/index.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L267)

###### startedAt

> **startedAt**: `number`

###### completedAt

> **completedAt**: `number`

###### durationMs

> **durationMs**: `number`

##### tokens?

> `optional` **tokens?**: `object`

Defined in: [src/intelligence/index.ts:268](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L268)

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

Defined in: [src/intelligence/index.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L274)

###### name

> **name**: `string`

###### message

> **message**: `string`

###### code?

> `optional` **code?**: `string`

##### candidateExecution?

> `optional` **candidateExecution?**: `CandidateExecutionEvidence`

Defined in: [src/intelligence/index.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L276)

Exact proposal → review → execution → receipt linkage for candidate runs.

***

### RunReport

Defined in: [src/intelligence/index.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L285)

What an agent reports (via `applied.record`) to enrich the [RunRecord](#runrecord)
sent for its call. All optional — an un-recorded run still sends input/output
with an inference-only zero usage split. `costUsd` without a split is treated
as pure inference (the base stream).

#### Properties

##### success?

> `optional` **success?**: `boolean`

Defined in: [src/intelligence/index.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L286)

##### score?

> `optional` **score?**: `number`

Defined in: [src/intelligence/index.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L287)

##### usage?

> `optional` **usage?**: `Partial`\<[`UsageSplit`](#usagesplit)\>

Defined in: [src/intelligence/index.ts:288](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L288)

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [src/intelligence/index.ts:289](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L289)

##### model?

> `optional` **model?**: `string`

Defined in: [src/intelligence/index.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L290)

##### provider?

> `optional` **provider?**: `string`

Defined in: [src/intelligence/index.ts:291](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L291)

##### loopEvents?

> `optional` **loopEvents?**: [`LoopTraceEvent`](runtime.md#looptraceevent)[]

Defined in: [src/intelligence/index.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L292)

##### runtimeEvents?

> `optional` **runtimeEvents?**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

Defined in: [src/intelligence/index.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L293)

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [src/intelligence/index.ts:294](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L294)

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [src/intelligence/index.ts:295](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L295)

##### harness?

> `optional` **harness?**: `string`

Defined in: [src/intelligence/index.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L296)

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: [src/intelligence/index.ts:297](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L297)

##### tokens?

> `optional` **tokens?**: `object`

Defined in: [src/intelligence/index.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L298)

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

Defined in: [src/intelligence/index.ts:299](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L299)

###### name

> **name**: `string`

###### message

> **message**: `string`

###### code?

> `optional` **code?**: `string`

##### candidateExecution?

> `optional` **candidateExecution?**: `CandidateExecutionEvidence`

Defined in: [src/intelligence/index.ts:300](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L300)

***

### RepoConfig

Defined in: [src/intelligence/index.ts:306](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L306)

Repo coordinates a product may declare for the (later) Gated-PR mode. The
 Observe slice only records their PRESENCE for `doctor()`; it never touches
 the repo.

#### Properties

##### owner

> **owner**: `string`

Defined in: [src/intelligence/index.ts:307](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L307)

##### name

> **name**: `string`

Defined in: [src/intelligence/index.ts:308](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L308)

##### baseBranch

> **baseBranch**: `string`

Defined in: [src/intelligence/index.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L309)

***

### IntelligenceConfig

Defined in: [src/intelligence/index.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L315)

Client configuration. `project` + `apiKey` are the Observe minimum; the
 rest tune effort, endpoint, redaction, and (for `doctor()` readiness)
 declare the surfaces/checks/repo a later PR mode would need.

#### Extended by

- [`IntelligenceHookConfig`](#intelligencehookconfig)

#### Properties

##### project

> **project**: `string`

Defined in: [src/intelligence/index.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L317)

Stable project id — the tenant dimension every trace is tagged with.

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [src/intelligence/index.ts:319](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L319)

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Defined in: [src/intelligence/index.ts:321](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L321)

Effort tier (default `'standard'`) plus optional per-field overrides.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [src/intelligence/index.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L329)

The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
receive (`/v1/profiles/:target/composed`) paths derive from it. Reads
`TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
Send is best-effort and only ships when an `apiKey` is present (the tenant
key the ingest requires); absent a key, export is a no-op.

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Defined in: [src/intelligence/index.ts:335](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L335)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

##### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: [src/intelligence/index.ts:337](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L337)

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

##### checks?

> `optional` **checks?**: `string`[]

Defined in: [src/intelligence/index.ts:339](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L339)

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Defined in: [src/intelligence/index.ts:341](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L341)

Repo access a later PR mode would need. Recorded for `doctor()` only.

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [src/intelligence/index.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L343)

Full canonical profile used for this agent. Exported redacted with a stable hash.

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: [src/intelligence/index.ts:345](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L345)

Commit that produced the running agent, when known.

##### runtimeTelemetry?

> `optional` **runtimeTelemetry?**: [`RuntimeTelemetryOptions`](index.md#runtimetelemetryoptions)

Defined in: [src/intelligence/index.ts:347](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L347)

Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled.

##### payloadAttributes?

> `optional` **payloadAttributes?**: `"metadata"` \| `"full"`

Defined in: [src/intelligence/index.ts:354](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L354)

Payloads are metadata-only by default: the run span carries a stable hash
and UTF-8 byte count, but not the redacted content. Set `full` only when
the configured OTLP destination is approved to receive complete redacted
inputs, outputs, and profiles.

***

### TraceMeta

Defined in: [src/intelligence/index.ts:358](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L358)

Metadata describing one traced run. `runId`/`traceId` default to fresh ids.

#### Properties

##### input?

> `optional` **input?**: `unknown`

Defined in: [src/intelligence/index.ts:360](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L360)

The run's input — exported through the redactor.

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/intelligence/index.ts:362](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L362)

Stable run id. Defaults to a fresh id.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [src/intelligence/index.ts:364](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L364)

32-hex trace id. Defaults to a fresh id.

##### model?

> `optional` **model?**: `string`

Defined in: [src/intelligence/index.ts:366](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L366)

Model id, when known — stamped on the span.

##### provider?

> `optional` **provider?**: `string`

Defined in: [src/intelligence/index.ts:368](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L368)

Provider name, when known — stamped on the span.

##### labels?

> `optional` **labels?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [src/intelligence/index.ts:370](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L370)

Arbitrary extra labels (string/number/boolean) stamped on the span.

***

### TraceHandle

Defined in: [src/intelligence/index.ts:379](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L379)

The trace handle a `traceRun` body records into. `recordOutput` captures the
agent's result (redacted on export); `recordOutcome` captures the scored
outcome + the `{ inferenceUsd, intelligenceUsd }` split. Both are optional —
an un-recorded run still exports a span with whatever was set.

#### Methods

##### recordOutput()

> **recordOutput**(`output`): `void`

Defined in: [src/intelligence/index.ts:381](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L381)

Capture the run's output. Exported through the redactor.

###### Parameters

###### output

`unknown`

###### Returns

`void`

##### recordOutcome()

> **recordOutcome**(`outcome`): `void`

Defined in: [src/intelligence/index.ts:388](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L388)

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

Defined in: [src/intelligence/index.ts:397](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L397)

Metadata for [IntelligenceClient.recordTrace](#recordtrace).

#### Properties

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [src/intelligence/index.ts:399](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L399)

32-hex trace id to anchor every span to. Defaults to a fresh id.

##### rootParentSpanId?

> `optional` **rootParentSpanId?**: `string`

Defined in: [src/intelligence/index.ts:402](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L402)

Span id of an enclosing span the loop root should parent under (e.g. a
 `traceRun` span). Omitted ⇒ the loop root is the trace root.

***

### TraceOutcome

Defined in: [src/intelligence/index.ts:407](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L407)

The resolved outcome of one traced run, surfaced on the export span and
 available to the caller for downstream billing assertions.

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/intelligence/index.ts:408](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L408)

##### traceId

> **traceId**: `string`

Defined in: [src/intelligence/index.ts:409](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L409)

##### project

> **project**: `string`

Defined in: [src/intelligence/index.ts:410](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L410)

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

Defined in: [src/intelligence/index.ts:412](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L412)

The resolved effort settings this run executed under.

##### intelligenceOff

> **intelligenceOff**: `boolean`

Defined in: [src/intelligence/index.ts:414](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L414)

True when this run ran as pure passthrough (the OFF floor).

##### success?

> `optional` **success?**: `boolean`

Defined in: [src/intelligence/index.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L415)

##### score?

> `optional` **score?**: `number`

Defined in: [src/intelligence/index.ts:416](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L416)

##### usage

> **usage**: [`UsageSplit`](#usagesplit)

Defined in: [src/intelligence/index.ts:418](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L418)

Per-class billing split. `intelligenceUsd` is `0` at the OFF tier.

***

### IntelligenceClient

Defined in: [src/intelligence/index.ts:422](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L422)

The Observe-mode Intelligence client.

#### Properties

##### project

> `readonly` **project**: `string`

Defined in: [src/intelligence/index.ts:424](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L424)

The resolved project id.

##### effort

> `readonly` **effort**: [`EffortSettings`](#effortsettings)

Defined in: [src/intelligence/index.ts:426](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L426)

The resolved effort settings.

#### Methods

##### traceRun()

> **traceRun**\<`T`\>(`meta`, `fn`): `Promise`\<`T`\>

Defined in: [src/intelligence/index.ts:432](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L432)

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

Defined in: [src/intelligence/index.ts:442](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L442)

Export a run's full loop topology — the ordered `LoopTraceEvent` stream a
`runAgentRounds`/`Supervisor` run emits — as a nested OTLP span tree (loop → round →
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

Defined in: [src/intelligence/index.ts:450](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L450)

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

Defined in: [src/intelligence/index.ts:452](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L452)

Mint a fresh run id (`run-<hex>`).

###### Returns

`string`

##### freshTraceId()

> **freshTraceId**(): `string`

Defined in: [src/intelligence/index.ts:454](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L454)

Mint a fresh 32-hex trace id.

###### Returns

`string`

##### doctor()

> **doctor**(): [`DoctorReport`](#doctorreport)

Defined in: [src/intelligence/index.ts:460](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L460)

Network-free readiness report: which adoption modes are reachable given
this config. Observe is always reachable; Recommend needs outcomes; PR
needs checks + surfaces + repo.

###### Returns

[`DoctorReport`](#doctorreport)

##### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [src/intelligence/index.ts:462](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L462)

Flush any pending export spans. Best-effort; resolves even if export fails.

###### Returns

`Promise`\<`void`\>

***

### ModeReadiness

Defined in: [src/intelligence/index.ts:466](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L466)

One mode's readiness verdict.

#### Properties

##### ready

> **ready**: `boolean`

Defined in: [src/intelligence/index.ts:467](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L467)

##### missing

> **missing**: `string`[]

Defined in: [src/intelligence/index.ts:469](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L469)

Inputs this mode still needs, when not ready. Empty when ready.

***

### DoctorReport

Defined in: [src/intelligence/index.ts:473](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L473)

The `doctor()` readiness report — Mode-readiness without any network call.

#### Properties

##### project

> **project**: `string`

Defined in: [src/intelligence/index.ts:474](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L474)

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

Defined in: [src/intelligence/index.ts:475](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L475)

##### exportConfigured

> **exportConfigured**: `boolean`

Defined in: [src/intelligence/index.ts:477](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L477)

True when an OTLP endpoint is configured (export will actually ship).

##### modes

> **modes**: `object`

Defined in: [src/intelligence/index.ts:478](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L478)

###### observe

> **observe**: [`ModeReadiness`](#modereadiness)

###### recommend

> **recommend**: [`ModeReadiness`](#modereadiness)

###### pr

> **pr**: [`ModeReadiness`](#modereadiness)

***

### OptimizationActivationReceipt

Defined in: [src/intelligence/optimization-receipt.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L24)

#### Properties

##### kind

> **kind**: `"optimization-activation-receipt"`

Defined in: [src/intelligence/optimization-receipt.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L25)

##### method

> **method**: `string`

Defined in: [src/intelligence/optimization-receipt.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L26)

##### source

> **source**: `OptimizationPackageSource`

Defined in: [src/intelligence/optimization-receipt.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L27)

##### bridge?

> `optional` **bridge?**: `OptimizationPackageSource`

Defined in: [src/intelligence/optimization-receipt.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L28)

##### modules?

> `optional` **modules?**: `OptimizationModuleSource`[]

Defined in: [src/intelligence/optimization-receipt.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L29)

##### python?

> `optional` **python?**: `OptimizationPythonRuntime`

Defined in: [src/intelligence/optimization-receipt.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L30)

##### models?

> `optional` **models?**: `object`

Defined in: [src/intelligence/optimization-receipt.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L31)

###### candidate?

> `optional` **candidate?**: `AgentProfileModelHints`

###### optimizer?

> `optional` **optimizer?**: `string`

##### usage

> **usage**: `object`

Defined in: [src/intelligence/optimization-receipt.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L35)

###### optimizerEvaluations

> **optimizerEvaluations**: `number`

###### optimizerTokens?

> `optional` **optimizerTokens?**: `OptimizationTokenUsage`

##### cost

> **cost**: `object`

Defined in: [src/intelligence/optimization-receipt.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L39)

###### optimization

> **optimization**: [`OptimizationReceiptCost`](#optimizationreceiptcost)

###### finalTest

> **finalTest**: [`OptimizationReceiptCost`](#optimizationreceiptcost)

###### total

> **total**: [`OptimizationReceiptCost`](#optimizationreceiptcost)

##### invocation

> **invocation**: `object`

Defined in: [src/intelligence/optimization-receipt.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L44)

###### runtimeInvocationId

> **runtimeInvocationId**: `string`

###### optimizerRunId

> **optimizerRunId**: `string`

###### compatibleOptimizerRunId?

> `optional` **compatibleOptimizerRunId?**: `string`

###### resumed

> **resumed**: `boolean`

###### artifactDir

> **artifactDir**: `string`

##### developmentDataDigest

> **developmentDataDigest**: `` `sha256:${string}` ``

Defined in: [src/intelligence/optimization-receipt.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L51)

##### digest

> **digest**: `` `sha256:${string}` ``

Defined in: [src/intelligence/optimization-receipt.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L52)

***

### OptimizationReceiptCost

Defined in: [src/intelligence/optimization-receipt.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L55)

#### Properties

##### totalUsd

> **totalUsd**: `number`

Defined in: [src/intelligence/optimization-receipt.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L56)

##### accountingComplete

> **accountingComplete**: `boolean`

Defined in: [src/intelligence/optimization-receipt.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L57)

##### incompleteReasons

> **incompleteReasons**: `string`[]

Defined in: [src/intelligence/optimization-receipt.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L58)

***

### AgentImprovementProfileReplacement

Defined in: [src/intelligence/profile-activation.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L44)

#### Properties

##### identity

> **identity**: `string`

Defined in: [src/intelligence/profile-activation.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L45)

##### profile

> **profile**: `AgentProfile`

Defined in: [src/intelligence/profile-activation.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L46)

***

### AgentImprovementProfileStateDigestInput

Defined in: [src/intelligence/profile-activation.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L49)

#### Properties

##### identity

> **identity**: `string`

Defined in: [src/intelligence/profile-activation.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L50)

##### profile

> **profile**: `AgentProfile`

Defined in: [src/intelligence/profile-activation.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L51)

***

### AgentImprovementProfileStateResolverInput

Defined in: [src/intelligence/profile-activation.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L59)

#### Properties

##### identity

> **identity**: `string`

Defined in: [src/intelligence/profile-activation.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L60)

##### stateDigest

> **stateDigest**: `` `sha256:${string}` ``

Defined in: [src/intelligence/profile-activation.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L61)

***

### ProvisionedHost

Defined in: [src/intelligence/resolver.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L50)

A live, provisioned host the resolver tore up for a `process-on-infra` arm.
 `teardown()` runs at `dispose()` in reverse provisioning order.

#### Properties

##### mcpConnection?

> `optional` **mcpConnection?**: `AgentProfileMcpServer`

Defined in: [src/intelligence/resolver.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L53)

Lower the inner binding's mcp connection now that the host is up; the URL/
 command points at the host. Absent when the host serves a non-mcp inner.

#### Methods

##### teardown()

> **teardown**(): `Promise`\<`void`\>

Defined in: [src/intelligence/resolver.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L54)

###### Returns

`Promise`\<`void`\>

***

### ResolveCtx

Defined in: [src/intelligence/resolver.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L62)

Per-call, per-tenant context the resolver reads. Everything that touches the
network, a secret, or an infra provisioner is INJECTED so the manifest carries
no live secret and the substrate-free caller wires only what it can host.

#### Properties

##### tenant?

> `optional` **tenant?**: `string`

Defined in: [src/intelligence/resolver.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L64)

Stable tenant id — namespaces billing + teardown (`tenant#target`).

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [src/intelligence/resolver.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L66)

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

Defined in: [src/intelligence/resolver.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L72)

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

Defined in: [src/intelligence/resolver.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L81)

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

Defined in: [src/intelligence/resolver.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L93)

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

Defined in: [src/intelligence/resolver.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L106)

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

Defined in: [src/intelligence/resolver.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L114)

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

Defined in: [src/intelligence/with-intelligence.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L53)

What the hook hands the agent each run. Additive over the prompt-only
 delivery: `composePrompt` folds the certified prompt surface (as before);
 `proposals`/`applyProfile` surface the promoted profile DIFFS — never
 auto-applied; `record` enriches the [RunRecord](#runrecord) that is sent.

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/intelligence/with-intelligence.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L55)

Stable ids shared by the run span and every nested runtime/loop span.

##### traceId

> **traceId**: `string`

Defined in: [src/intelligence/with-intelligence.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L56)

##### certified

> **certified**: [`CertifiedProfile`](#certifiedprofile) \| `null`

Defined in: [src/intelligence/with-intelligence.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L59)

The certified profile in effect (null when none promoted / pull failed —
 fail-closed: the agent runs on its base surface).

##### proposals

> **proposals**: [`ProposedProfileDiff`](#proposedprofilediff)[]

Defined in: [src/intelligence/with-intelligence.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L65)

The promoted, gate-certified profile diffs — surfaced for a human or the
 gated `improve()` loop. NEVER auto-applied by this hook. Empty when none.

#### Methods

##### composePrompt()

> **composePrompt**(`base`): `string`

Defined in: [src/intelligence/with-intelligence.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L62)

Fold the certified prompt surface into a base system prompt (the promoted
 prompt). The consumer opts in by calling it.

###### Parameters

###### base

`string`

###### Returns

`string`

##### applyProfile()

> **applyProfile**(`base`): `AgentProfile`

Defined in: [src/intelligence/with-intelligence.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L69)

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

Defined in: [src/intelligence/with-intelligence.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L73)

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

Defined in: [src/intelligence/with-intelligence.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L83)

`withIntelligence` config = the Observe config plus the pull target, refresh
 cadence, and a proposals callback. One base URL (`baseUrl` /
 `TANGLE_INTELLIGENCE_URL`) drives both the send and receive paths.

#### Extends

- [`IntelligenceConfig`](#intelligenceconfig)

#### Properties

##### project

> **project**: `string`

Defined in: [src/intelligence/index.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L317)

Stable project id — the tenant dimension every trace is tagged with.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`project`](#project-1)

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [src/intelligence/index.ts:319](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L319)

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`apiKey`](#apikey-3)

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Defined in: [src/intelligence/index.ts:321](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L321)

Effort tier (default `'standard'`) plus optional per-field overrides.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`effort`](#effort)

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [src/intelligence/index.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L329)

The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
receive (`/v1/profiles/:target/composed`) paths derive from it. Reads
`TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
Send is best-effort and only ships when an `apiKey` is present (the tenant
key the ingest requires); absent a key, export is a no-op.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`baseUrl`](#baseurl-3)

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Defined in: [src/intelligence/index.ts:335](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L335)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`redact`](#redact)

##### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: [src/intelligence/index.ts:337](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L337)

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`surfaces`](#surfaces)

##### checks?

> `optional` **checks?**: `string`[]

Defined in: [src/intelligence/index.ts:339](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L339)

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`checks`](#checks)

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Defined in: [src/intelligence/index.ts:341](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L341)

Repo access a later PR mode would need. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`repo`](#repo)

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [src/intelligence/index.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L343)

Full canonical profile used for this agent. Exported redacted with a stable hash.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`profile`](#profile-3)

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: [src/intelligence/index.ts:345](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L345)

Commit that produced the running agent, when known.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`commitSha`](#commitsha-2)

##### runtimeTelemetry?

> `optional` **runtimeTelemetry?**: [`RuntimeTelemetryOptions`](index.md#runtimetelemetryoptions)

Defined in: [src/intelligence/index.ts:347](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L347)

Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`runtimeTelemetry`](#runtimetelemetry)

##### payloadAttributes?

> `optional` **payloadAttributes?**: `"metadata"` \| `"full"`

Defined in: [src/intelligence/index.ts:354](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L354)

Payloads are metadata-only by default: the run span carries a stable hash
and UTF-8 byte count, but not the redacted content. Set `full` only when
the configured OTLP destination is approved to receive complete redacted
inputs, outputs, and profiles.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`payloadAttributes`](#payloadattributes)

##### target?

> `optional` **target?**: `string`

Defined in: [src/intelligence/with-intelligence.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L85)

Pull target. Defaults to `project`.

##### refreshMs?

> `optional` **refreshMs?**: `number`

Defined in: [src/intelligence/with-intelligence.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L87)

Min interval between certified-profile pulls. Default 5m.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [src/intelligence/with-intelligence.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L89)

Per-pull timeout in ms (fail-closed on a hung plane). Default 10000.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [src/intelligence/with-intelligence.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L91)

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

Defined in: [src/intelligence/with-intelligence.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L94)

Notified when a refresh delivers a NEW set of promoted proposals (by
 provenance content hash). Surfaces diffs without auto-applying them.

###### Parameters

###### proposals

[`ProposedProfileDiff`](#proposedprofilediff)[]

###### Returns

`void`

## Type Aliases

### AgentProfileImprovementActivationOperation

> **AgentProfileImprovementActivationOperation** = \{ `kind`: `"apply-change"`; `changes`: `AgentProfileImprovementChange`; \} \| \{ `kind`: `"restore-state"`; \}

Defined in: [src/intelligence/activation.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L53)

#### Union Members

##### Type Literal

\{ `kind`: `"apply-change"`; `changes`: `AgentProfileImprovementChange`; \}

***

##### Type Literal

\{ `kind`: `"restore-state"`; \}

###### kind

> **kind**: `"restore-state"`

The product must load its own saved state at `desiredStateDigest`.

***

### AgentImprovementActivationTransitionInput

> **AgentImprovementActivationTransitionInput** = [`SealedCandidateActivationTransitionInput`](#sealedcandidateactivationtransitioninput) \| [`ProfileImprovementActivationTransitionInput`](#profileimprovementactivationtransitioninput)

Defined in: [src/intelligence/activation.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L98)

***

### AgentImprovementActivationTransition

> **AgentImprovementActivationTransition** = (`input`) => `Promise`\<`unknown`\>

Defined in: [src/intelligence/activation.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L116)

Product-owned or Runtime-composed transition.

Implementations resolve a stored result for `activation.digest`, compare
every target, and make the write durably idempotent. Co-located targets store
the all-or-none write with its result. Other targets throw when result
storage fails so a retry can reconcile it. Runtime never invokes this write
function after authorization expires.

#### Parameters

##### input

[`AgentImprovementActivationTransitionInput`](#agentimprovementactivationtransitioninput)

#### Returns

`Promise`\<`unknown`\>

***

### AgentImprovementActivationReconciliation

> **AgentImprovementActivationReconciliation** = (`input`) => `Promise`\<`unknown` \| `undefined`\>

Defined in: [src/intelligence/activation.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L125)

Target-read-only check for a prior exact write.
It may persist recovered result metadata, but must not change an activation target.
Return undefined only when no target write can have committed.

#### Parameters

##### input

[`AgentImprovementActivationTransitionInput`](#agentimprovementactivationtransitioninput)

#### Returns

`Promise`\<`unknown` \| `undefined`\>

***

### JsonSchema

> **JsonSchema** = `Record`\<`string`, `unknown`\>

Defined in: [src/intelligence/capability.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L37)

A JSON Schema object describing a tool's parameters. Kept structural — the
 resolver forwards it verbatim into a `ToolSpec` / MCP `tools/list` check.

***

### CapabilityInterface

> **CapabilityInterface** = \{ `surface`: `"tool"`; `name`: `string`; `description?`: `string`; `parameters`: [`JsonSchema`](#jsonschema); `returns?`: [`JsonSchema`](#jsonschema); \} \| \{ `surface`: `"mcp"`; `serverName`: `string`; `toolset?`: `string`[]; \} \| \{ `surface`: `"context"`; `kind`: `"prompt-surface"` \| `"skill"` \| `"instructions"`; `name`: `string`; \} \| \{ `surface`: `"retrieval"`; `name`: `string`; `description?`: `string`; `topK?`: `number`; \} \| \{ `surface`: `"hook"`; `event`: `string`; `matcher?`: `string`; \} \| \{ `surface`: `"subagent"`; `name`: `string`; `description?`: `string`; \}

Defined in: [src/intelligence/capability.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L43)

What the agent consumes. CLOSED — a new runtime kind NEVER extends this. Each
arm maps slot-for-slot onto `AgentProfile` + the host `RouterToolsSeam`.

***

### CapabilitySurface

> **CapabilitySurface** = [`CapabilityInterface`](#capabilityinterface)\[`"surface"`\]

Defined in: [src/intelligence/capability.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L58)

Every interface surface tag — the closed set the resolver fans into slots.

***

### ContentRef

> **ContentRef** = \{ `kind`: `"inline"`; `content`: `string`; \} \| \{ `kind`: `"github"`; `repository?`: `string`; `path`: `string`; `ref?`: `string`; \} \| \{ `kind`: `"blob"`; `uri`: `string`; `sha256`: `string`; `bytes?`: `number`; \}

Defined in: [src/intelligence/capability.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L66)

Where a capability's bytes live. A leaked manifest carries no live secret and
no inlined blob: `github`/`blob` are pointers resolved at provision time.

***

### CapabilityAuth

> **CapabilityAuth** = \{ `mode`: `"none"`; \} \| \{ `mode`: `"tangle-key"`; \} \| \{ `mode`: `"hub-connection"`; `providerId`: `string`; `scopes?`: `string`[]; \} \| \{ `mode`: `"secret-ref"`; `key`: `string`; \}

Defined in: [src/intelligence/capability.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L81)

How a binding authenticates at resolve time. Declared as a REQUIREMENT in the
manifest; the live secret is resolved per-tenant by the resolver context,
never inlined here.

***

### DeliveryBinding

> **DeliveryBinding** = \{ `kind`: `"inline"`; `content`: [`ContentRef`](#contentref); \} \| \{ `kind`: `"file"`; `path`: `string`; `content`: [`ContentRef`](#contentref); `executable?`: `boolean`; \} \| \{ `kind`: `"http"`; `url`: `string`; `method?`: `string`; `auth?`: [`CapabilityAuth`](#capabilityauth); \} \| \{ `kind`: `"sandbox-code"`; `entry`: `string`; `code`: [`ContentRef`](#contentref); `runtime?`: `string`; `harness?`: `string`; \} \| \{ `kind`: `"mcp-stdio"`; `command`: `string`; `args?`: `string`[]; `env?`: `Record`\<`string`, `string`\>; `cwd?`: `string`; \} \| \{ `kind`: `"mcp-remote"`; `url`: `string`; `transport`: `"http"` \| `"sse"`; `headers?`: `Record`\<`string`, `string`\>; \} \| \{ `kind`: `"process-on-infra"`; `host`: [`HostSpec`](#hostspec); `inner`: [`DeliveryBinding`](#deliverybinding); \} \| \{ `kind`: `"rag-index"`; `index`: [`ContentRef`](#contentref); `embedModel`: `string`; `topK?`: `number`; \} \| \{ `kind`: `"memory-store"`; `provision`: `"sqlite"` \| `"neo4j"` \| `"vector"`; `seed?`: [`ContentRef`](#contentref); \} \| \{ `kind`: `"wasm"`; `module`: [`ContentRef`](#contentref); `exports`: `string`[]; \} \| \{ `kind`: `"a2a"`; `endpoint`: `string`; `card`: [`ContentRef`](#contentref); `auth?`: [`CapabilityAuth`](#capabilityauth); \}

Defined in: [src/intelligence/capability.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L109)

How a capability is backed. OPEN tagged union — THE extension point. All arms
are typed even when the resolver does not yet admit them; an un-admitted arm
throws [CapabilityNotAdmittedError](#capabilitynotadmittederror) at resolve, never silently no-ops.

***

### DeliveryBindingKind

> **DeliveryBindingKind** = [`DeliveryBinding`](#deliverybinding)\[`"kind"`\]

Defined in: [src/intelligence/capability.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L138)

Every binding kind — the open set the resolver dispatches over.

***

### PullOutcome

> **PullOutcome** = \{ `succeeded`: `true`; `value`: [`CertifiedProfile`](#certifiedprofile); \} \| \{ `succeeded`: `false`; `error`: `string`; `status?`: `number`; \}

Defined in: [src/intelligence/delivery.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L109)

Typed outcome for the pull — inspect `succeeded` before `value`. A 404
 (nothing promoted yet) is a normal, non-error `succeeded: false`.

***

### AgentImprovementProposalSubmissionState

> **AgentImprovementProposalSubmissionState** = `"not-sent"` \| `"rejected"` \| `"unconfirmed"`

Defined in: [src/intelligence/delivery.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L131)

What Runtime knows about a failed proposal submission.
`not-sent` means no request began, `rejected` means Intelligence returned a
definitive 4xx response, and `unconfirmed` means the caller may safely retry
the same immutable proposal.

***

### SubmitAgentImprovementProposalOutcome

> **SubmitAgentImprovementProposalOutcome** = \{ `succeeded`: `true`; `value`: `AgentImprovementProposal`; `status`: `number`; \} \| \{ `succeeded`: `false`; `submission`: [`AgentImprovementProposalSubmissionState`](#agentimprovementproposalsubmissionstate); `error`: `string`; `status?`: `number`; `code?`: `string`; \}

Defined in: [src/intelligence/delivery.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L149)

Typed result for proposal submission. A successful result contains the
exact immutable proposal Intelligence recorded.

***

### EffortTier

> **EffortTier** = `"off"` \| `"eco"` \| `"standard"` \| `"thorough"` \| `"max"`

Defined in: [src/intelligence/effort.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L20)

The named effort tiers, lowest to highest. `'off'` is the honest floor
 below `'eco'`: intelligence fully off, telemetry still best-effort.

***

### CorpusAccess

> **CorpusAccess** = `"off"` \| `"read"` \| `"read-write"`

Defined in: [src/intelligence/effort.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L25)

Corpus access an intelligence tier permits. `'off'` reads and writes
 nothing; `'read'` consults the cross-run corpus without contributing;
 `'read-write'` both consults and accumulates.

***

### EffortOverrides

> **EffortOverrides** = `Partial`\<[`EffortSettings`](#effortsettings)\>

Defined in: [src/intelligence/effort.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L52)

Per-field overrides applied on top of a tier preset. Any subset of the
 resolved settings; each provided field wins over the preset.

***

### AgentCandidateExecutionHostPorts

> **AgentCandidateExecutionHostPorts** = `Omit`\<[`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports), `"models"`\>

Defined in: [src/intelligence/exact-process-candidate.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L62)

Product-owned candidate ports other than protected model access.

***

### AgentImprovementExperimentMaterial

> **AgentImprovementExperimentMaterial** = `Omit`\<`AgentCandidateExperimentMaterial`, `"candidateLineage"`\>

Defined in: [src/intelligence/improvement-cycle.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L197)

Product-supplied experiment material. Runtime supplies optimizer ancestry and the final digest.

***

### AgentImprovementProfileSurface

> **AgentImprovementProfileSurface** = *typeof* [`AGENT_IMPROVEMENT_PROFILE_SURFACES`](#agent_improvement_profile_surfaces)\[`number`\]

Defined in: [src/intelligence/improvement-surfaces.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L50)

***

### AgentImprovementActivationTargetIdentity

> **AgentImprovementActivationTargetIdentity** = `Pick`\<`AgentImprovementActivationTarget`, `"surface"` \| `"identity"`\>

Defined in: [src/intelligence/improvement-surfaces.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L58)

***

### UsageClass

> **UsageClass** = `"inference"` \| `"intelligence"`

Defined in: [src/intelligence/index.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L225)

Usage class for billing. Base-stream tokens bill `'inference'`; every
 intelligence spawn (analyst, corpus, loop) bills `'intelligence'`. The
 billing line falls on the spawn line.

***

### AgentImprovementProfileActivationTarget

> **AgentImprovementProfileActivationTarget** = `Omit`\<[`AgentImprovementActivationTargetPlan`](#agentimprovementactivationtargetplan), `"surface"`\> & `object`

Defined in: [src/intelligence/profile-activation.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L27)

#### Type Declaration

##### surface

> **surface**: [`AgentImprovementProfileSurface`](#agentimprovementprofilesurface)

***

### AgentImprovementProfileTargetState

> **AgentImprovementProfileTargetState** = `Omit`\<`AgentImprovementActivationTargetState`, `"surface"`\> & `object`

Defined in: [src/intelligence/profile-activation.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L34)

#### Type Declaration

##### surface

> **surface**: [`AgentImprovementProfileSurface`](#agentimprovementprofilesurface)

***

### AgentImprovementProfileTargetTransition

> **AgentImprovementProfileTargetTransition** = `Omit`\<`AgentImprovementActivationTargetTransition`, `"surface"`\> & `object`

Defined in: [src/intelligence/profile-activation.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L39)

#### Type Declaration

##### surface

> **surface**: [`AgentImprovementProfileSurface`](#agentimprovementprofilesurface)

***

### AgentImprovementProfileStateDigest

> **AgentImprovementProfileStateDigest** = (`input`) => `Sha256Digest`

Defined in: [src/intelligence/profile-activation.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L55)

Product-defined hash of the complete profile state that actually runs.

#### Parameters

##### input

[`AgentImprovementProfileStateDigestInput`](#agentimprovementprofilestatedigestinput)

#### Returns

`Sha256Digest`

***

### AgentImprovementProfileStateResolver

> **AgentImprovementProfileStateResolver** = (`input`) => `AgentProfile` \| `undefined`

Defined in: [src/intelligence/profile-activation.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L65)

Product-owned retained-state lookup used only for an explicit restore.

#### Parameters

##### input

[`AgentImprovementProfileStateResolverInput`](#agentimprovementprofilestateresolverinput)

#### Returns

`AgentProfile` \| `undefined`

***

### AgentImprovementProfileActivationInput

> **AgentImprovementProfileActivationInput** = \{ `currentByIdentity`: `ReadonlyMap`\<`string`, `AgentProfile`\>; `targets`: readonly \[[`AgentImprovementProfileActivationTarget`](#agentimprovementprofileactivationtarget), `...AgentImprovementProfileActivationTarget[]`\]; \} \| \{ `currentByIdentity`: `ReadonlyMap`\<`string`, `AgentProfile`\>; `profileTransition`: [`ProfileImprovementActivationTransitionInput`](#profileimprovementactivationtransitioninput); `stateDigest`: [`AgentImprovementProfileStateDigest`](#agentimprovementprofilestatedigest); `resolveState?`: [`AgentImprovementProfileStateResolver`](#agentimprovementprofilestateresolver); \}

Defined in: [src/intelligence/profile-activation.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L69)

***

### AgentImprovementProfileActivationPreparation

> **AgentImprovementProfileActivationPreparation** = \{ `status`: `"missing"`; `identities`: readonly `string`[]; \} \| \{ `status`: `"unavailable"`; `code`: `"PROFILE_STATE_UNAVAILABLE"`; `identities`: readonly `string`[]; `requiredStateDigest`: `Sha256Digest`; \} \| \{ `status`: `"already-applied"` \| `"conflict"`; `targets`: \[[`AgentImprovementProfileTargetState`](#agentimprovementprofiletargetstate), `...AgentImprovementProfileTargetState[]`\]; \} \| \{ `status`: `"apply"`; `replacements`: \[[`AgentImprovementProfileReplacement`](#agentimprovementprofilereplacement), `...AgentImprovementProfileReplacement[]`\]; `targets`: \[[`AgentImprovementProfileTargetTransition`](#agentimprovementprofiletargettransition), `...AgentImprovementProfileTargetTransition[]`\]; \}

Defined in: [src/intelligence/profile-activation.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L84)

***

### IntelligenceAgent

> **IntelligenceAgent**\<`I`, `O`\> = (`input`, `applied`) => `Promise`\<`O`\>

Defined in: [src/intelligence/with-intelligence.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L78)

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

Defined in: [src/intelligence/with-intelligence.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L99)

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

***

### Redactor

> **Redactor** = (`value`) => `unknown`

Defined in: [src/redact.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/redact.ts#L17)

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

Defined in: [src/intelligence/effort.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L95)

The default tier when a client declares no effort. `'standard'` turns
 intelligence on with sensible knobs; opt down to `'off'`/`'eco'` or up to
 `'thorough'`/`'max'`.

***

### exactProcessCandidateExperimentExecutionSupport

> `const` **exactProcessCandidateExperimentExecutionSupport**: `Readonly`\<\{ `outcomes`: readonly \[`"output"`\]; `outputMediaTypes`: readonly \[`"text/*"`, `"application/json"`, `"*+json"`\]; `code`: readonly \[`"disabled"`\]; `memory`: readonly \[`"disabled"`\]; `knowledge`: `true`; `profile`: `Readonly`\<\{ `mcpTransports`: readonly \[`"stdio"`\]; `remoteMcp`: `false`; `tools`: `false`; `permissions`: `false`; `modes`: `false`; `confidential`: `false`; \}\>; `isolation`: `Readonly`\<\{ `freshEnvironment`: `true`; `exactProcess`: `true`; `egress`: readonly \[`"blocked"`, `"strict"`\]; \}\>; \}\>

Defined in: [src/intelligence/exact-process-candidate.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L31)

Candidate surfaces implemented by the neutral exact-process executor.

***

### AGENT\_IMPROVEMENT\_PROFILE\_SURFACES

> `const` **AGENT\_IMPROVEMENT\_PROFILE\_SURFACES**: readonly \[`"prompt"`, `"skills"`, `"tools"`, `"mcp"`, `"hooks"`, `"subagents"`\]

Defined in: [src/intelligence/improvement-surfaces.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L41)

Agent improvement surfaces delivered as exact `AgentProfileDiff` replacements.

## Functions

### parseCandidateProfileMaterialization()

> **parseCandidateProfileMaterialization**(`input`, `expectedProfilePlanDigest?`): `AgentCandidateProfileActivation`

Defined in: [src/candidate-execution/profile.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/profile.ts#L79)

Parse and check every native file hash plus both canonical document digests.

#### Parameters

##### input

`unknown`

##### expectedProfilePlanDigest?

`` `sha256:${string}` ``

#### Returns

`AgentCandidateProfileActivation`

***

### createAgentImprovementActivationResult()

> **createAgentImprovementActivationResult**(`transition`, `options`): `AgentImprovementActivationResult`

Defined in: [src/intelligence/activation.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L142)

Create the exact result a product stores in the same transaction as its target write.

#### Parameters

##### transition

[`AgentImprovementActivationTransitionInput`](#agentimprovementactivationtransitioninput)

##### options

[`CreateAgentImprovementActivationResultOptions`](#createagentimprovementactivationresultoptions)

#### Returns

`AgentImprovementActivationResult`

***

### verifyAgentImprovementActivationResult()

> **verifyAgentImprovementActivationResult**(`input`): `AgentImprovementActivationResult`

Defined in: [src/intelligence/activation.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L173)

Recompute one historical activation result against the exact measured proposal and authority.
The result records that attempt; it is not a query of the target's current state.

#### Parameters

##### input

###### proposal

`unknown`

###### review

`unknown`

###### activation

`unknown`

###### result

`unknown`

#### Returns

`AgentImprovementActivationResult`

***

### executeAgentImprovementActivation()

> **executeAgentImprovementActivation**(`input`, `options`): `Promise`\<`AgentImprovementActivationResult`\>

Defined in: [src/intelligence/activation.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/activation.ts#L191)

Validate and execute one product-owned activation transition.

#### Parameters

##### input

[`ExecuteAgentImprovementActivationInput`](#executeagentimprovementactivationinput)

##### options

[`ExecuteAgentImprovementActivationOptions`](#executeagentimprovementactivationoptions)

#### Returns

`Promise`\<`AgentImprovementActivationResult`\>

***

### manifestFromProfile()

> **manifestFromProfile**(`profile`): [`CapabilityManifest`](#capabilitymanifest)

Defined in: [src/intelligence/capability.ts:366](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L366)

Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`.
`prompt-surface`/`skill` artifacts → `context`/inline capabilities (the
shipped fold, generalized); any other artifact type → best-effort binding
inference. `promptSurface` is carried through so
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

Defined in: [src/intelligence/delivery.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L181)

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

Defined in: [src/intelligence/delivery.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L255)

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

Defined in: [src/intelligence/delivery.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L285)

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

### submitAgentImprovementProposal()

> **submitAgentImprovementProposal**(`opts`): `Promise`\<[`SubmitAgentImprovementProposalOutcome`](#submitagentimprovementproposaloutcome)\>

Defined in: [src/intelligence/delivery.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L329)

Submit a completed Runtime proposal to Intelligence for product-side review.
This never runs an experiment, approves a proposal, or applies a candidate.
A 4xx response is a confirmed `rejected` request. Network failures, timeouts,
5xx responses, and invalid success responses are `unconfirmed`, so callers
can retry the same digest because Intelligence stores proposals idempotently.

#### Parameters

##### opts

[`SubmitAgentImprovementProposalOptions`](#submitagentimprovementproposaloptions)

#### Returns

`Promise`\<[`SubmitAgentImprovementProposalOutcome`](#submitagentimprovementproposaloutcome)\>

***

### composeCertifiedPrompt()

> **composeCertifiedPrompt**(`base`, `certified`): `string`

Defined in: [src/intelligence/delivery.ts:421](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L421)

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

Defined in: [src/intelligence/delivery.ts:467](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L467)

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

Defined in: [src/intelligence/effort.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L108)

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

Defined in: [src/intelligence/effort.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L129)

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

Defined in: [src/intelligence/effort.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L179)

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

### createExactProcessCandidateExperimentExecutor()

> **createExactProcessCandidateExperimentExecutor**(`options`): [`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor)

Defined in: [src/intelligence/exact-process-candidate.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L96)

Execute one signed experiment cell through any declared exact-process provider.

#### Parameters

##### options

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions)

#### Returns

[`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor)

***

### createProtectedExactProcessCandidateExperimentExecutor()

> **createProtectedExactProcessCandidateExperimentExecutor**(`options`): [`ProtectedExactProcessCandidateExperimentExecutor`](#protectedexactprocesscandidateexperimentexecutor)

Defined in: [src/intelligence/exact-process-candidate.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/exact-process-candidate.ts#L143)

Compose host-owned execution ports with protected model access for one exact-process run.

#### Parameters

##### options

[`CreateProtectedExactProcessCandidateExperimentExecutorOptions`](#createprotectedexactprocesscandidateexperimentexecutoroptions)

#### Returns

[`ProtectedExactProcessCandidateExperimentExecutor`](#protectedexactprocesscandidateexperimentexecutor)

***

### runAgentCandidateExperiment()

> **runAgentCandidateExperiment**(`options`): `Promise`\<[`RunAgentCandidateExperimentResult`](#runagentcandidateexperimentresult)\>

Defined in: [src/intelligence/improvement-cycle.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L244)

Execute both arms of one immutable experiment and derive its paired result.

#### Parameters

##### options

[`RunAgentCandidateExperimentOptions`](#runagentcandidateexperimentoptions)

#### Returns

`Promise`\<[`RunAgentCandidateExperimentResult`](#runagentcandidateexperimentresult)\>

***

### executeAgentCandidateExperimentCell()

> **executeAgentCandidateExperimentCell**(`options`): `Promise`\<`CandidateExecutionEvidence`\>

Defined in: [src/intelligence/improvement-cycle.ts:275](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L275)

Execute one exact arm, task, repetition, seed, and attempt through Runtime.

#### Parameters

##### options

[`ExecuteAgentCandidateExperimentCellOptions`](#executeagentcandidateexperimentcelloptions)

#### Returns

`Promise`\<`CandidateExecutionEvidence`\>

***

### createAgentImprovementMeasuredComparison()

> **createAgentImprovementMeasuredComparison**(`options`): `AgentImprovementMeasuredComparison`

Defined in: [src/intelligence/improvement-cycle.ts:331](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L331)

Delegate all statistics and promotion checks to agent-eval's receipt-based comparison.

#### Parameters

##### options

`CompareCandidateExperimentOptions`

#### Returns

`AgentImprovementMeasuredComparison`

***

### proposeAgentImprovement()

> **proposeAgentImprovement**\<`TScenario`, `TArtifact`\>(`options`): `Promise`\<[`ProposeAgentImprovementResult`](#proposeagentimprovementresult)\<`TScenario`, `TArtifact`\>\>

Defined in: [src/intelligence/improvement-cycle.ts:338](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L338)

Analyze, search, then remeasure the resulting exact candidate before proposing it.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario$1`

##### TArtifact

`TArtifact`

#### Parameters

##### options

[`ProposeAgentImprovementOptions`](#proposeagentimprovementoptions)\<`TScenario`, `TArtifact`\>

#### Returns

`Promise`\<[`ProposeAgentImprovementResult`](#proposeagentimprovementresult)\<`TScenario`, `TArtifact`\>\>

***

### createAgentImprovementProposal()

> **createAgentImprovementProposal**(`options`): `AgentImprovementProposal`

Defined in: [src/intelligence/improvement-cycle.ts:443](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L443)

Create the reviewable record only from a complete, recomputable experiment result.

#### Parameters

##### options

[`CreateAgentImprovementProposalOptions`](#createagentimprovementproposaloptions)

#### Returns

`AgentImprovementProposal`

***

### reviewAgentImprovementProposal()

> **reviewAgentImprovementProposal**(`inputProposal`, `input`): `AgentImprovementReview`

Defined in: [src/intelligence/improvement-cycle.ts:468](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L468)

Persist a human or tenant-policy decision bound to one exact proposal.

#### Parameters

##### inputProposal

`AgentImprovementProposal`

##### input

[`ReviewAgentImprovementInput`](#reviewagentimprovementinput)

#### Returns

`AgentImprovementReview`

***

### createAgentImprovementActivation()

> **createAgentImprovementActivation**(`inputProposal`, `inputReview`, `options`): `AgentImprovementActivation`

Defined in: [src/intelligence/improvement-cycle.ts:496](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L496)

Authorize product-owned writes only after the exact candidate was measured and approved.

#### Parameters

##### inputProposal

`AgentImprovementProposal`

##### inputReview

`AgentImprovementReview`

##### options

[`CreateAgentImprovementActivationOptions`](#createagentimprovementactivationoptions)

#### Returns

`AgentImprovementActivation`

***

### verifyAgentImprovementProposal()

> **verifyAgentImprovementProposal**(`input`): `AgentImprovementProposal`

Defined in: [src/intelligence/improvement-cycle.ts:538](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L538)

Validate a proposal and recompute every binding to its measured experiment.

#### Parameters

##### input

`unknown`

#### Returns

`AgentImprovementProposal`

***

### verifyAgentImprovementReview()

> **verifyAgentImprovementReview**(`input`): `AgentImprovementReview`

Defined in: [src/intelligence/improvement-cycle.ts:615](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L615)

Validate the canonical identity and wire shape of an improvement review.

#### Parameters

##### input

`unknown`

#### Returns

`AgentImprovementReview`

***

### verifyAgentImprovementActivation()

> **verifyAgentImprovementActivation**(`input`): `AgentImprovementActivation`

Defined in: [src/intelligence/improvement-cycle.ts:623](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L623)

Validate activation authority against the exact proposal, review, experiment, and base state.

#### Parameters

##### input

###### proposal

`unknown`

###### review

`unknown`

###### activation

`unknown`

#### Returns

`AgentImprovementActivation`

***

### verifyCandidateExecutionEvidence()

> **verifyCandidateExecutionEvidence**(`input`, `options`): `CandidateExecutionEvidence`

Defined in: [src/intelligence/improvement-cycle.ts:657](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-cycle.ts#L657)

Recheck one Runtime receipt against its exact signed experiment cell.

#### Parameters

##### input

`unknown`

##### options

[`VerifyCandidateExecutionEvidenceOptions`](#verifycandidateexecutionevidenceoptions)

#### Returns

`CandidateExecutionEvidence`

***

### buildAgentImprovementActivationTargets()

> **buildAgentImprovementActivationTargets**(`surfaces`, `experiment`, `intent`, `identities`): \[`AgentImprovementActivationTarget`, `...AgentImprovementActivationTarget[]`\]

Defined in: [src/intelligence/improvement-surfaces.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L120)

Bind caller-owned target identities to the exact source state Runtime measured.

#### Parameters

##### surfaces

readonly `AgentImprovementSurface`[]

##### experiment

`AgentProfileImprovementExperiment` \| `AgentCandidateExperiment`

##### intent

`AgentImprovementActivationIntent`

##### identities

readonly [`AgentImprovementActivationTargetIdentity`](#agentimprovementactivationtargetidentity)[]

#### Returns

\[`AgentImprovementActivationTarget`, `...AgentImprovementActivationTarget[]`\]

***

### isAgentImprovementProfileSurface()

> **isAgentImprovementProfileSurface**(`surface`): surface is "tools" \| "mcp" \| "subagents" \| "hooks" \| "prompt" \| "skills"

Defined in: [src/intelligence/improvement-surfaces.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L225)

Return whether a measured surface can be delivered through an agent profile.

#### Parameters

##### surface

`AgentImprovementSurface`

#### Returns

surface is "tools" \| "mcp" \| "subagents" \| "hooks" \| "prompt" \| "skills"

***

### agentImprovementProfileSurfaceInput()

> **agentImprovementProfileSurfaceInput**(`profile`, `surface`): `unknown`

Defined in: [src/intelligence/improvement-surfaces.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L237)

Return the canonical current-state input for one profile-deliverable improvement target.
Missing slots become `null`; tools and subagents include both their direct and resource slots.
Unrelated profile fields are excluded. The result matches `agentImprovementTargetInput` for the
same profile inside a candidate bundle.

#### Parameters

##### profile

`AgentProfile`

##### surface

`"tools"` \| `"mcp"` \| `"subagents"` \| `"hooks"` \| `"prompt"` \| `"skills"`

#### Returns

`unknown`

***

### agentImprovementProfileSurfaceDigest()

> **agentImprovementProfileSurfaceDigest**(`profile`, `surface`): `` `sha256:${string}` ``

Defined in: [src/intelligence/improvement-surfaces.ts:275](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L275)

Return the `Sha256Digest` of one profile surface using Runtime's canonical candidate digest.

#### Parameters

##### profile

`AgentProfile`

##### surface

`"tools"` \| `"mcp"` \| `"subagents"` \| `"hooks"` \| `"prompt"` \| `"skills"`

#### Returns

`` `sha256:${string}` ``

***

### agentImprovementTargetProfileDiffs()

> **agentImprovementTargetProfileDiffs**(`target`, `options`): \[`AgentProfileDiff`, `...AgentProfileDiff[]`\]

Defined in: [src/intelligence/improvement-surfaces.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/improvement-surfaces.ts#L287)

Replace one measured profile surface exactly, including array-valued resources.
Apply the returned diffs in order: a diff applies its set before its removal,
so exact replacement requires a reset record followed by a set record.

#### Parameters

##### target

###### surface

`"tools"` \| `"mcp"` \| `"subagents"` \| `"hooks"` \| `"prompt"` \| `"skills"`

###### desiredInput

`unknown`

##### options

[`AgentImprovementTargetProfileDiffOptions`](#agentimprovementtargetprofilediffoptions)

#### Returns

\[`AgentProfileDiff`, `...AgentProfileDiff[]`\]

***

### createIntelligenceClient()

> **createIntelligenceClient**(`config`): [`IntelligenceClient`](#intelligenceclient)

Defined in: [src/intelligence/index.ts:544](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L544)

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

### createOptimizationActivationReceipt()

> **createOptimizationActivationReceipt**(`improvement`): [`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

Defined in: [src/intelligence/optimization-receipt.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L64)

Build a detached receipt only for methods backed by an identified external optimizer.

#### Parameters

##### improvement

[`ImproveMethodResult`](index.md#improvemethodresult)

#### Returns

[`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

***

### optimizationActivationReceiptFromMetadata()

> **optimizationActivationReceiptFromMetadata**(`metadata`): [`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

Defined in: [src/intelligence/optimization-receipt.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/optimization-receipt.ts#L130)

Read and verify the optimizer evidence carried by a measured proposal.

#### Parameters

##### metadata

\{\[`key`: `string`\]: `AgentCandidateJsonValue`; \} \| `undefined`

#### Returns

[`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

***

### prepareAgentImprovementProfileActivation()

> **prepareAgentImprovementProfileActivation**(`input`): [`AgentImprovementProfileActivationPreparation`](#agentimprovementprofileactivationpreparation)

Defined in: [src/intelligence/profile-activation.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/profile-activation.ts#L118)

Compare product-owned profiles with an exact measured transition and prepare
all-or-none replacements. The product owns locking, persistence, and retained
state; Runtime owns the profile diff semantics and digest checks.

#### Parameters

##### input

[`AgentImprovementProfileActivationInput`](#agentimprovementprofileactivationinput)

#### Returns

[`AgentImprovementProfileActivationPreparation`](#agentimprovementprofileactivationpreparation)

***

### composeCertifiedProfile()

> **composeCertifiedProfile**(`base`, `manifest`, `ctx?`): `Promise`\<[`ResolvedSurface`](#resolvedsurface)\>

Defined in: [src/intelligence/resolver.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L159)

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

Defined in: [src/intelligence/resolver.ts:660](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L660)

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

Defined in: [src/intelligence/with-intelligence.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/with-intelligence.ts#L169)

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

***

### defaultRedactor()

> **defaultRedactor**(`value`): `unknown`

Defined in: [src/redact.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/redact.ts#L61)

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

Defined in: [src/redact.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/redact.ts#L113)

Resolve the redactor a client uses. A caller-supplied hook handles
domain-specific values first, then the built-in scrubber still removes
common credentials and email addresses. Returning `false` is the explicit
opt-out for already-reviewed public values.

#### Parameters

##### redact

`false` \| [`Redactor`](#redactor) \| `undefined`

#### Returns

[`Redactor`](#redactor)
