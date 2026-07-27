[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / primeintellect

# primeintellect

## Interfaces

### WritePrimeIntellectPackageOptions

#### Properties

##### replace?

> `optional` **replace?**: `boolean`

Replace an existing generated package and restore it if the final swap fails.

***

### RunPrimeIntellectProgramOptions

#### Properties

##### env?

> `optional` **env?**: `ProcessEnv`

***

### PrimeUsage

#### Properties

##### prompt\_tokens

> **prompt\_tokens**: `number`

##### completion\_tokens

> **completion\_tokens**: `number`

##### cached\_input\_tokens?

> `optional` **cached\_input\_tokens?**: `number` \| `null`

##### reasoning\_tokens?

> `optional` **reasoning\_tokens?**: `number` \| `null`

##### cost?

> `optional` **cost?**: `number` \| `null`

***

### PrimeTraceNode

#### Properties

##### parent?

> `optional` **parent?**: `number` \| `null`

##### sampled?

> `optional` **sampled?**: `boolean`

##### usage?

> `optional` **usage?**: [`PrimeUsage`](#primeusage) \| `null`

##### message?

> `optional` **message?**: `unknown`

***

### PrimeTimeSpan

#### Properties

##### start?

> `optional` **start?**: `number`

##### end?

> `optional` **end?**: `number`

***

### PrimeIntellectTrace

#### Properties

##### id

> **id**: `string`

##### task

> **task**: `object`

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

##### nodes

> **nodes**: [`PrimeTraceNode`](#primetracenode)[]

##### rewards

> **rewards**: `Record`\<`string`, `number`\>

##### metrics

> **metrics**: `Record`\<`string`, `number`\>

##### info?

> `optional` **info?**: `Record`\<`string`, `unknown`\>

##### extra\_usage?

> `optional` **extra\_usage?**: [`PrimeUsage`](#primeusage)[]

##### is\_completed?

> `optional` **is\_completed?**: `boolean`

##### stop\_condition?

> `optional` **stop\_condition?**: `string` \| `null`

##### errors?

> `optional` **errors?**: `object`[]

###### type

> **type**: `string`

###### message

> **message**: `string`

###### traceback?

> `optional` **traceback?**: `string` \| `null`

##### timing?

> `optional` **timing?**: `object`

###### start?

> `optional` **start?**: `number`

###### setup?

> `optional` **setup?**: [`PrimeTimeSpan`](#primetimespan)

###### generation?

> `optional` **generation?**: [`PrimeTimeSpan`](#primetimespan)

###### finalize?

> `optional` **finalize?**: [`PrimeTimeSpan`](#primetimespan)

###### scoring?

> `optional` **scoring?**: [`PrimeTimeSpan`](#primetimespan)

***

### PrimeIntellectTraceImportOptions

#### Properties

##### experimentId

> **experimentId**: `string`

##### candidateId

> **candidateId**: `string`

##### seed

> **seed**: `number`

##### model

> **model**: `string`

Snapshot-pinned model id required by RunRecord validation.

##### promptHash

> **promptHash**: `string`

##### configHash

> **configHash**: `string`

##### commitSha

> **commitSha**: `string`

***

### PrimeIntellectTask

One immutable problem. References stay inside Prime's task process.

#### Properties

##### id

> **id**: `string`

##### split

> **split**: [`PrimeIntellectSplit`](#primeintellectsplit)

##### prompt

> **prompt**: `string` \| [`PrimeIntellectMessage`](#primeintellectmessage)[]

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

##### answer?

> `optional` **answer?**: `string` \| `string`[]

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, [`PrimeIntellectJson`](#primeintellectjson)\>

***

### PrimeIntellectRunner

Files and commands that make the caller's real agent program runnable.

#### Properties

##### command

> **command**: readonly \[`string`, `string`\]

##### files?

> `optional` **files?**: `Readonly`\<`Record`\<`string`, `string`\>\>

##### setup?

> `optional` **setup?**: readonly [`PrimeIntellectSetupCommand`](#primeintellectsetupcommand)[]

##### forwardEnv?

> `optional` **forwardEnv?**: readonly `string`[]

##### image

> **image**: `string`

Container image used by the generated eval config.

***

### PrimeIntellectPackageOptions

#### Properties

##### name

> **name**: `string`

##### version

> **version**: `string`

##### description?

> `optional` **description?**: `string`

##### tasks

> **tasks**: readonly [`PrimeIntellectTask`](#primeintellecttask)[]

##### scoring

> **scoring**: [`PrimeIntellectScoring`](#primeintellectscoring)

##### runner

> **runner**: [`PrimeIntellectRunner`](#primeintellectrunner)

##### maxTurns?

> `optional` **maxTurns?**: `number`

Prime-enforced model turn cap. Default 16.

##### maxInputTokens?

> `optional` **maxInputTokens?**: `number`

##### maxOutputTokens?

> `optional` **maxOutputTokens?**: `number`

##### maxTotalTokens?

> `optional` **maxTotalTokens?**: `number`

##### rolloutTimeoutSeconds?

> `optional` **rolloutTimeoutSeconds?**: `number`

##### scoringTimeoutSeconds?

> `optional` **scoringTimeoutSeconds?**: `number`

***

### PrimeIntellectPackageManifest

#### Properties

##### kind

> **kind**: `"tangle.primeintellect.package"`

##### name

> **name**: `string`

##### moduleName

> **moduleName**: `string`

##### version

> **version**: `string`

##### verifiers

> **verifiers**: `">=0.2.0,<0.3.0"`

##### taskCount

> **taskCount**: `number`

##### splits

> **splits**: `Record`\<[`PrimeIntellectSplit`](#primeintellectsplit), `number`\>

##### taskIdsSha256

> **taskIdsSha256**: `string`

##### filesSha256

> **filesSha256**: `Record`\<`string`, `string`\>

***

### PrimeIntellectPackageBundle

#### Properties

##### manifest

> **manifest**: [`PrimeIntellectPackageManifest`](#primeintellectpackagemanifest)

##### files

> **files**: `Readonly`\<`Record`\<`string`, `string`\>\>

Relative package path to UTF-8 contents.

***

### PrimeIntellectPublicTask

The answer-free task exposed to the caller's runtime program.

#### Properties

##### id

> **id**: `string`

##### split

> **split**: [`PrimeIntellectSplit`](#primeintellectsplit)

##### prompt

> **prompt**: `string` \| [`PrimeIntellectMessage`](#primeintellectmessage)[]

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, [`PrimeIntellectJson`](#primeintellectjson)\>

***

### PrimeIntellectEpisodeContext

#### Properties

##### task

> **task**: [`PrimeIntellectPublicTask`](#primeintellectpublictask)

##### model

> **model**: `object`

###### name

> **name**: `string`

###### baseUrl

> **baseUrl**: `string`

###### apiKey

> **apiKey**: `string`

##### mcpServers

> **mcpServers**: `Readonly`\<`Record`\<`string`, `string`\>\>

## Type Aliases

### PrimeIntellectBackendOptions

> **PrimeIntellectBackendOptions** = `Omit`\<`Parameters`\<*typeof* [`createOpenAICompatibleBackend`](index.md#createopenaicompatiblebackend)\>\[`0`\], `"apiKey"` \| `"baseUrl"` \| `"model"`\>

***

### PrimeIntellectImportDefaults

> **PrimeIntellectImportDefaults** = [`PrimeIntellectTraceImportOptions`](#primeintellecttraceimportoptions)

***

### PrimeIntellectSplit

> **PrimeIntellectSplit** = `"train"` \| `"eval"`

***

### PrimeIntellectJson

> **PrimeIntellectJson** = `null` \| `boolean` \| `number` \| `string` \| [`PrimeIntellectJson`](#primeintellectjson)[] \| \{\[`key`: `string`\]: [`PrimeIntellectJson`](#primeintellectjson); \}

***

### PrimeIntellectContent

> **PrimeIntellectContent** = `string` \| (\{ `type`: `"text"`; `text`: `string`; \} \| \{ `type`: `"image_url"`; `image_url`: \{ `url`: `string`; \}; \})[]

***

### PrimeIntellectMessage

> **PrimeIntellectMessage** = \{ `role`: `"system"` \| `"user"`; `content`: [`PrimeIntellectContent`](#primeintellectcontent); \} \| \{ `role`: `"assistant"`; `content?`: `string` \| `null`; `reasoning_content?`: `string` \| `null`; `tool_calls?`: `object`[]; `provider_state?`: `Record`\<`string`, [`PrimeIntellectJson`](#primeintellectjson)\>[]; \} \| \{ `role`: `"tool"`; `tool_call_id`: `string`; `content`: [`PrimeIntellectContent`](#primeintellectcontent); `name?`: `string`; \}

***

### PrimeIntellectScoring

> **PrimeIntellectScoring** = \{ `kind`: `"exact"`; `normalization?`: `"none"` \| `"trim"` \| `"trim-casefold"`; \} \| \{ `kind`: `"reference-judge"`; `model`: `string`; `prompt?`: `string`; `view?`: `"last_reply"` \| `"full_trace"`; \} \| \{ `kind`: `"command"`; `command`: readonly \[`string`, `...string[]`\]; `files?`: `Readonly`\<`Record`\<`string`, `string`\>\>; `forwardEnv?`: readonly `string`[]; `timeoutSeconds?`: `number`; \}

***

### PrimeIntellectSetupCommand

> **PrimeIntellectSetupCommand** = readonly \[`string`, `...string[]`\]

## Functions

### createPrimeIntellectPackage()

> **createPrimeIntellectPackage**(`options`): [`PrimeIntellectPackageBundle`](#primeintellectpackagebundle)

Build a complete PrimeIntellect Verifiers package without writing to disk.

#### Parameters

##### options

[`PrimeIntellectPackageOptions`](#primeintellectpackageoptions)

#### Returns

[`PrimeIntellectPackageBundle`](#primeintellectpackagebundle)

***

### writePrimeIntellectPackage()

> **writePrimeIntellectPackage**(`bundle`, `outputDirectory`, `options?`): `Promise`\<`string`\>

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

Read and validate the private process contract installed by the generated Prime harness.

#### Parameters

##### env?

`ProcessEnv` = `process.env`

#### Returns

[`PrimeIntellectEpisodeContext`](#primeintellectepisodecontext)

***

### createPrimeIntellectBackend()

> **createPrimeIntellectBackend**(`context`, `options?`): [`AgentExecutionBackend`](index.md#agentexecutionbackend)\<[`AgentBackendInput`](index.md#agentbackendinput)\>

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

Execute the caller's canonical runtime program inside a Prime rollout.
The callback may call runPersonified, runAgentic, runAgentRounds, or any product wrapper.

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

Parse Prime's durable `traces.jsonl` and reject malformed rows with a line number.

#### Parameters

##### jsonl

`string`

#### Returns

[`PrimeIntellectTrace`](#primeintellecttrace)[]

***

### importPrimeIntellectTraces()

> **importPrimeIntellectTraces**(`jsonl`, `defaults`): `RunRecord`[]

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

Project one complete Prime trace into the common agent-eval analysis row.

#### Parameters

##### trace

[`PrimeIntellectTrace`](#primeintellecttrace)

##### options

[`PrimeIntellectTraceImportOptions`](#primeintellecttraceimportoptions)

#### Returns

`RunRecord`
