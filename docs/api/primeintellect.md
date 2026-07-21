[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / primeintellect

# primeintellect

## Interfaces

### WritePrimeIntellectPackageOptions

Defined in: [src/primeintellect/package.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/package.ts#L23)

#### Properties

##### replace?

> `optional` **replace?**: `boolean`

Defined in: [src/primeintellect/package.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/package.ts#L25)

Replace an existing generated package and restore it if the final swap fails.

***

### RunPrimeIntellectProgramOptions

Defined in: [src/primeintellect/runner.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/runner.ts#L17)

#### Properties

##### env?

> `optional` **env?**: `ProcessEnv`

Defined in: [src/primeintellect/runner.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/runner.ts#L18)

***

### PrimeIntellectTrace

Defined in: [src/primeintellect/traces.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L23)

#### Properties

##### id

> **id**: `string`

Defined in: [src/primeintellect/traces.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L24)

##### task

> **task**: `object`

Defined in: [src/primeintellect/traces.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L25)

###### type

> **type**: `string`

###### data

> **data**: `object`

###### Index Signature

\[`key`: `string`\]: `unknown`

###### data.idx

> **idx**: `number`

###### data.name?

> `optional` **name?**: `string` \| `null`

###### data.split?

> `optional` **split?**: `"train"` \| `"eval"`

###### data.prompt?

> `optional` **prompt?**: `unknown`

###### data.system\_prompt?

> `optional` **system\_prompt?**: `string` \| `null`

###### data.metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

##### runtime?

> `optional` **runtime?**: `unknown`

Defined in: [src/primeintellect/traces.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L37)

##### nodes

> **nodes**: `PrimeTraceNode`[]

Defined in: [src/primeintellect/traces.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L38)

##### rewards

> **rewards**: `Record`\<`string`, `number`\>

Defined in: [src/primeintellect/traces.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L39)

##### metrics

> **metrics**: `Record`\<`string`, `number`\>

Defined in: [src/primeintellect/traces.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L40)

##### info?

> `optional` **info?**: `Record`\<`string`, `unknown`\>

Defined in: [src/primeintellect/traces.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L41)

##### extra\_usage?

> `optional` **extra\_usage?**: `PrimeUsage`[]

Defined in: [src/primeintellect/traces.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L42)

##### is\_completed?

> `optional` **is\_completed?**: `boolean`

Defined in: [src/primeintellect/traces.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L43)

##### stop\_condition?

> `optional` **stop\_condition?**: `string` \| `null`

Defined in: [src/primeintellect/traces.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L44)

##### errors?

> `optional` **errors?**: `object`[]

Defined in: [src/primeintellect/traces.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L45)

###### type

> **type**: `string`

###### message

> **message**: `string`

###### traceback?

> `optional` **traceback?**: `string` \| `null`

##### timing?

> `optional` **timing?**: `object`

Defined in: [src/primeintellect/traces.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L46)

###### start?

> `optional` **start?**: `number`

###### setup?

> `optional` **setup?**: `PrimeTimeSpan`

###### generation?

> `optional` **generation?**: `PrimeTimeSpan`

###### finalize?

> `optional` **finalize?**: `PrimeTimeSpan`

###### scoring?

> `optional` **scoring?**: `PrimeTimeSpan`

***

### PrimeIntellectTraceImportOptions

Defined in: [src/primeintellect/traces.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L55)

#### Properties

##### experimentId

> **experimentId**: `string`

Defined in: [src/primeintellect/traces.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L56)

##### candidateId

> **candidateId**: `string`

Defined in: [src/primeintellect/traces.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L57)

##### seed

> **seed**: `number`

Defined in: [src/primeintellect/traces.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L58)

##### model

> **model**: `string`

Defined in: [src/primeintellect/traces.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L60)

Snapshot-pinned model id required by RunRecord validation.

##### promptHash

> **promptHash**: `string`

Defined in: [src/primeintellect/traces.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L61)

##### configHash

> **configHash**: `string`

Defined in: [src/primeintellect/traces.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L62)

##### commitSha

> **commitSha**: `string`

Defined in: [src/primeintellect/traces.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L63)

***

### PrimeIntellectTask

Defined in: [src/primeintellect/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L32)

One immutable problem. References stay inside Prime's task process.

#### Properties

##### id

> **id**: `string`

Defined in: [src/primeintellect/types.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L33)

##### split

> **split**: [`PrimeIntellectSplit`](#primeintellectsplit)

Defined in: [src/primeintellect/types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L34)

##### prompt

> **prompt**: `string` \| [`PrimeIntellectMessage`](#primeintellectmessage)[]

Defined in: [src/primeintellect/types.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L35)

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: [src/primeintellect/types.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L36)

##### answer?

> `optional` **answer?**: `string` \| `string`[]

Defined in: [src/primeintellect/types.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L37)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, [`PrimeIntellectJson`](#primeintellectjson)\>

Defined in: [src/primeintellect/types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L38)

***

### PrimeIntellectRunner

Defined in: [src/primeintellect/types.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L63)

Files and commands that make the caller's real agent program runnable.

#### Properties

##### command

> **command**: readonly \[`string`, `string`\]

Defined in: [src/primeintellect/types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L64)

##### files?

> `optional` **files?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/primeintellect/types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L65)

##### setup?

> `optional` **setup?**: readonly [`PrimeIntellectSetupCommand`](#primeintellectsetupcommand)[]

Defined in: [src/primeintellect/types.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L66)

##### forwardEnv?

> `optional` **forwardEnv?**: readonly `string`[]

Defined in: [src/primeintellect/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L67)

##### image

> **image**: `string`

Defined in: [src/primeintellect/types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L69)

Container image used by the generated eval config.

***

### PrimeIntellectPackageOptions

Defined in: [src/primeintellect/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L72)

#### Properties

##### name

> **name**: `string`

Defined in: [src/primeintellect/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L73)

##### version

> **version**: `string`

Defined in: [src/primeintellect/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L74)

##### description?

> `optional` **description?**: `string`

Defined in: [src/primeintellect/types.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L75)

##### tasks

> **tasks**: readonly [`PrimeIntellectTask`](#primeintellecttask)[]

Defined in: [src/primeintellect/types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L76)

##### scoring

> **scoring**: [`PrimeIntellectScoring`](#primeintellectscoring)

Defined in: [src/primeintellect/types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L77)

##### runner

> **runner**: [`PrimeIntellectRunner`](#primeintellectrunner)

Defined in: [src/primeintellect/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L78)

##### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: [src/primeintellect/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L80)

Prime-enforced model turn cap. Default 16.

##### maxInputTokens?

> `optional` **maxInputTokens?**: `number`

Defined in: [src/primeintellect/types.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L81)

##### maxOutputTokens?

> `optional` **maxOutputTokens?**: `number`

Defined in: [src/primeintellect/types.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L82)

##### maxTotalTokens?

> `optional` **maxTotalTokens?**: `number`

Defined in: [src/primeintellect/types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L83)

##### rolloutTimeoutSeconds?

> `optional` **rolloutTimeoutSeconds?**: `number`

Defined in: [src/primeintellect/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L84)

##### scoringTimeoutSeconds?

> `optional` **scoringTimeoutSeconds?**: `number`

Defined in: [src/primeintellect/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L85)

***

### PrimeIntellectPackageManifest

Defined in: [src/primeintellect/types.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L88)

#### Properties

##### schema

> **schema**: `"tangle.primeintellect.package/v1"`

Defined in: [src/primeintellect/types.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L89)

##### name

> **name**: `string`

Defined in: [src/primeintellect/types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L90)

##### moduleName

> **moduleName**: `string`

Defined in: [src/primeintellect/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L91)

##### version

> **version**: `string`

Defined in: [src/primeintellect/types.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L92)

##### verifiers

> **verifiers**: `">=0.2.0,<0.3.0"`

Defined in: [src/primeintellect/types.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L93)

##### taskCount

> **taskCount**: `number`

Defined in: [src/primeintellect/types.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L94)

##### splits

> **splits**: `Record`\<[`PrimeIntellectSplit`](#primeintellectsplit), `number`\>

Defined in: [src/primeintellect/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L95)

##### taskIdsSha256

> **taskIdsSha256**: `string`

Defined in: [src/primeintellect/types.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L96)

##### filesSha256

> **filesSha256**: `Record`\<`string`, `string`\>

Defined in: [src/primeintellect/types.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L97)

***

### PrimeIntellectPackageBundle

Defined in: [src/primeintellect/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L100)

#### Properties

##### manifest

> **manifest**: [`PrimeIntellectPackageManifest`](#primeintellectpackagemanifest)

Defined in: [src/primeintellect/types.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L101)

##### files

> **files**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/primeintellect/types.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L103)

Relative package path to UTF-8 contents.

***

### PrimeIntellectPublicTask

Defined in: [src/primeintellect/types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L107)

The answer-free task exposed to the caller's runtime program.

#### Properties

##### id

> **id**: `string`

Defined in: [src/primeintellect/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L108)

##### split

> **split**: [`PrimeIntellectSplit`](#primeintellectsplit)

Defined in: [src/primeintellect/types.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L109)

##### prompt

> **prompt**: `string` \| [`PrimeIntellectMessage`](#primeintellectmessage)[]

Defined in: [src/primeintellect/types.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L110)

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: [src/primeintellect/types.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L111)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, [`PrimeIntellectJson`](#primeintellectjson)\>

Defined in: [src/primeintellect/types.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L112)

***

### PrimeIntellectEpisodeContext

Defined in: [src/primeintellect/types.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L115)

#### Properties

##### protocol

> **protocol**: `"tangle.primeintellect.episode/v1"`

Defined in: [src/primeintellect/types.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L116)

##### task

> **task**: [`PrimeIntellectPublicTask`](#primeintellectpublictask)

Defined in: [src/primeintellect/types.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L117)

##### model

> **model**: `object`

Defined in: [src/primeintellect/types.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L118)

###### name

> **name**: `string`

###### baseUrl

> **baseUrl**: `string`

###### apiKey

> **apiKey**: `string`

##### mcpServers

> **mcpServers**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/primeintellect/types.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L123)

## Type Aliases

### PrimeIntellectBackendOptions

> **PrimeIntellectBackendOptions** = `Omit`\<`Parameters`\<*typeof* [`createOpenAICompatibleBackend`](index.md#createopenaicompatiblebackend)\>\[`0`\], `"apiKey"` \| `"baseUrl"` \| `"model"`\>

Defined in: [src/primeintellect/runner.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/runner.ts#L21)

***

### PrimeIntellectImportDefaults

> **PrimeIntellectImportDefaults** = [`PrimeIntellectTraceImportOptions`](#primeintellecttraceimportoptions)

Defined in: [src/primeintellect/traces.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L66)

***

### PrimeIntellectSplit

> **PrimeIntellectSplit** = `"train"` \| `"eval"`

Defined in: [src/primeintellect/types.ts:1](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L1)

***

### PrimeIntellectJson

> **PrimeIntellectJson** = `null` \| `boolean` \| `number` \| `string` \| [`PrimeIntellectJson`](#primeintellectjson)[] \| \{\[`key`: `string`\]: [`PrimeIntellectJson`](#primeintellectjson); \}

Defined in: [src/primeintellect/types.ts:3](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L3)

***

### PrimeIntellectContent

> **PrimeIntellectContent** = `string` \| (\{ `type`: `"text"`; `text`: `string`; \} \| \{ `type`: `"image_url"`; `image_url`: \{ `url`: `string`; \}; \})[]

Defined in: [src/primeintellect/types.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L11)

***

### PrimeIntellectMessage

> **PrimeIntellectMessage** = \{ `role`: `"system"` \| `"user"`; `content`: [`PrimeIntellectContent`](#primeintellectcontent); \} \| \{ `role`: `"assistant"`; `content?`: `string` \| `null`; `reasoning_content?`: `string` \| `null`; `tool_calls?`: `object`[]; `provider_state?`: `Record`\<`string`, [`PrimeIntellectJson`](#primeintellectjson)\>[]; \} \| \{ `role`: `"tool"`; `tool_call_id`: `string`; `content`: [`PrimeIntellectContent`](#primeintellectcontent); `name?`: `string`; \}

Defined in: [src/primeintellect/types.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L15)

***

### PrimeIntellectScoring

> **PrimeIntellectScoring** = \{ `kind`: `"exact"`; `normalization?`: `"none"` \| `"trim"` \| `"trim-casefold"`; \} \| \{ `kind`: `"reference-judge"`; `model`: `string`; `prompt?`: `string`; `view?`: `"last_reply"` \| `"full_trace"`; \} \| \{ `kind`: `"command"`; `command`: readonly \[`string`, `...string[]`\]; `files?`: `Readonly`\<`Record`\<`string`, `string`\>\>; `forwardEnv?`: readonly `string`[]; `timeoutSeconds?`: `number`; \}

Defined in: [src/primeintellect/types.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L41)

***

### PrimeIntellectSetupCommand

> **PrimeIntellectSetupCommand** = readonly \[`string`, `...string[]`\]

Defined in: [src/primeintellect/types.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/types.ts#L60)

## Functions

### createPrimeIntellectPackage()

> **createPrimeIntellectPackage**(`options`): [`PrimeIntellectPackageBundle`](#primeintellectpackagebundle)

Defined in: [src/primeintellect/package.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/package.ts#L29)

Build a complete PrimeIntellect Verifiers v1 package without writing to disk.

#### Parameters

##### options

[`PrimeIntellectPackageOptions`](#primeintellectpackageoptions)

#### Returns

[`PrimeIntellectPackageBundle`](#primeintellectpackagebundle)

***

### writePrimeIntellectPackage()

> **writePrimeIntellectPackage**(`bundle`, `outputDirectory`, `options?`): `Promise`\<`string`\>

Defined in: [src/primeintellect/package.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/package.ts#L90)

Write a bundle through a sibling temporary directory, then rename it into place.

#### Parameters

##### bundle

[`PrimeIntellectPackageBundle`](#primeintellectpackagebundle)

##### outputDirectory

`string`

##### options?

[`WritePrimeIntellectPackageOptions`](#writeprimeintellectpackageoptions) = `{}`

#### Returns

`Promise`\<`string`\>

***

### readPrimeIntellectEpisodeContext()

> **readPrimeIntellectEpisodeContext**(`env?`): [`PrimeIntellectEpisodeContext`](#primeintellectepisodecontext)

Defined in: [src/primeintellect/runner.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/runner.ts#L27)

Read and validate the private process contract installed by the generated Prime harness.

#### Parameters

##### env?

`ProcessEnv` = `process.env`

#### Returns

[`PrimeIntellectEpisodeContext`](#primeintellectepisodecontext)

***

### createPrimeIntellectBackend()

> **createPrimeIntellectBackend**(`context`, `options?`): [`AgentExecutionBackend`](index.md#agentexecutionbackend)\<[`AgentBackendInput`](index.md#agentbackendinput)\>

Defined in: [src/primeintellect/runner.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/runner.ts#L50)

Build the existing runtime backend against Prime's intercepted model endpoint.

#### Parameters

##### context

[`PrimeIntellectEpisodeContext`](#primeintellectepisodecontext)

##### options?

[`PrimeIntellectBackendOptions`](#primeintellectbackendoptions) = `{}`

#### Returns

[`AgentExecutionBackend`](index.md#agentexecutionbackend)\<[`AgentBackendInput`](index.md#agentbackendinput)\>

***

### runPrimeIntellectProgram()

> **runPrimeIntellectProgram**\<`Result`\>(`run`, `options?`): `Promise`\<`Result`\>

Defined in: [src/primeintellect/runner.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/runner.ts#L67)

Execute the caller's canonical runtime program inside a Prime rollout.
The callback may call runPersonified, runAgentic, runLoop, or any product wrapper.

#### Type Parameters

##### Result

`Result`

#### Parameters

##### run

(`context`) => `Promise`\<`Result`\>

##### options?

[`RunPrimeIntellectProgramOptions`](#runprimeintellectprogramoptions) = `{}`

#### Returns

`Promise`\<`Result`\>

***

### parsePrimeIntellectTraces()

> **parsePrimeIntellectTraces**(`jsonl`): [`PrimeIntellectTrace`](#primeintellecttrace)[]

Defined in: [src/primeintellect/traces.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L69)

Parse Prime's durable `traces.jsonl` and reject malformed rows with a line number.

#### Parameters

##### jsonl

`string`

#### Returns

[`PrimeIntellectTrace`](#primeintellecttrace)[]

***

### importPrimeIntellectTraces()

> **importPrimeIntellectTraces**(`jsonl`, `defaults`): `RunRecord`[]

Defined in: [src/primeintellect/traces.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L90)

Convert all Prime traces to agent-eval RunRecords while retaining one shared run config.

#### Parameters

##### jsonl

`string`

##### defaults

[`PrimeIntellectTraceImportOptions`](#primeintellecttraceimportoptions)

#### Returns

`RunRecord`[]

***

### primeIntellectTraceToRunRecord()

> **primeIntellectTraceToRunRecord**(`trace`, `options`): `RunRecord`

Defined in: [src/primeintellect/traces.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/primeintellect/traces.ts#L100)

Project one complete Prime trace into the common agent-eval analysis row.

#### Parameters

##### trace

[`PrimeIntellectTrace`](#primeintellecttrace)

##### options

[`PrimeIntellectTraceImportOptions`](#primeintellecttraceimportoptions)

#### Returns

`RunRecord`
