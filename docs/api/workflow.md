[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / workflow

# workflow

## Classes

### WorkflowBudget

Defined in: [workflow/budget.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L11)

#### Implements

- [`WorkflowBudgetView`](#workflowbudgetview)

#### Constructors

##### Constructor

> **new WorkflowBudget**(`total`, `now`): [`WorkflowBudget`](#workflowbudget)

Defined in: [workflow/budget.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L20)

###### Parameters

###### total

[`WorkflowBudgetCaps`](#workflowbudgetcaps)

###### now

() => `number`

###### Returns

[`WorkflowBudget`](#workflowbudget)

#### Properties

##### total

> `readonly` **total**: [`WorkflowBudgetCaps`](#workflowbudgetcaps)

Defined in: [workflow/budget.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L12)

###### Implementation of

[`WorkflowBudgetView`](#workflowbudgetview).[`total`](#total-1)

#### Methods

##### spent()

> **spent**(): [`WorkflowBudgetSnapshot`](#workflowbudgetsnapshot)

Defined in: [workflow/budget.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L26)

###### Returns

[`WorkflowBudgetSnapshot`](#workflowbudgetsnapshot)

###### Implementation of

[`WorkflowBudgetView`](#workflowbudgetview).[`spent`](#spent-1)

##### remaining()

> **remaining**(): [`WorkflowBudgetRemaining`](#workflowbudgetremaining-1)

Defined in: [workflow/budget.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L36)

###### Returns

[`WorkflowBudgetRemaining`](#workflowbudgetremaining-1)

###### Implementation of

[`WorkflowBudgetView`](#workflowbudgetview).[`remaining`](#remaining-1)

##### nextAgentIndex()

> **nextAgentIndex**(): `number`

Defined in: [workflow/budget.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L52)

###### Returns

`number`

##### nextLoopIndex()

> **nextLoopIndex**(): `number`

Defined in: [workflow/budget.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L64)

###### Returns

`number`

##### assertFanout()

> **assertFanout**(`count`): `void`

Defined in: [workflow/budget.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L76)

###### Parameters

###### count

`number`

###### Returns

`void`

##### observe()

> **observe**(`result`): `object`

Defined in: [workflow/budget.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L89)

###### Parameters

###### result

[`WorkflowDelegateResult`](#workflowdelegateresult)

###### Returns

`object`

###### costUsd

> **costUsd**: `number`

###### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](#workflowtokenusage)

##### assertWall()

> **assertWall**(): `void`

Defined in: [workflow/budget.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L106)

###### Returns

`void`

##### remainingWallMs()

> **remainingWallMs**(): `number` \| `undefined`

Defined in: [workflow/budget.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/budget.ts#L112)

###### Returns

`number` \| `undefined`

## Interfaces

### WorkflowSandboxAgentTrace

Defined in: [workflow/agent-delegate.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L34)

#### Type Parameters

##### TOutput

`TOutput` = `unknown`

#### Properties

##### prompt

> **prompt**: `string`

Defined in: [workflow/agent-delegate.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L35)

##### options

> **options**: [`WorkflowAgentOptions`](#workflowagentoptions)

Defined in: [workflow/agent-delegate.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L36)

##### ctx

> **ctx**: [`WorkflowDelegateContext`](#workflowdelegatecontext)

Defined in: [workflow/agent-delegate.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L37)

##### profile

> **profile**: `AgentProfile`

Defined in: [workflow/agent-delegate.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L38)

##### output

> **output**: `TOutput`

Defined in: [workflow/agent-delegate.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L39)

##### events

> **events**: `SandboxEvent`[]

Defined in: [workflow/agent-delegate.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L40)

##### stream

> **stream**: [`WorkflowSandboxAgentStream`](#workflowsandboxagentstream)

Defined in: [workflow/agent-delegate.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L41)

##### placement

> **placement**: [`LoopSandboxPlacement`](runtime.md#loopsandboxplacement)

Defined in: [workflow/agent-delegate.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L42)

##### costUsd

> **costUsd**: `number`

Defined in: [workflow/agent-delegate.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L43)

##### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](#workflowtokenusage)

Defined in: [workflow/agent-delegate.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L44)

***

### CreateSandboxWorkflowAgentDelegateOptions

Defined in: [workflow/agent-delegate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L47)

#### Type Parameters

##### TOutput

`TOutput` = `unknown`

#### Properties

##### client

> **client**: [`SandboxClient`](runtime.md#sandboxclient-2)

Defined in: [workflow/agent-delegate.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L48)

##### profile

> **profile**: [`WorkflowSandboxAgentProfileResolver`](#workflowsandboxagentprofileresolver)

Defined in: [workflow/agent-delegate.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L49)

##### output?

> `optional` **output?**: [`OutputAdapter`](runtime.md#outputadapter)\<`TOutput`\>

Defined in: [workflow/agent-delegate.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L50)

##### stream?

> `optional` **stream?**: [`WorkflowSandboxAgentStream`](#workflowsandboxagentstream)

Defined in: [workflow/agent-delegate.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L51)

##### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Defined in: [workflow/agent-delegate.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L52)

###### Type Declaration

###### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

##### promptOptions?

> `optional` **promptOptions?**: [`WorkflowSandboxPromptOptionsResolver`](#workflowsandboxpromptoptionsresolver)\<`PromptOptions`\>

Defined in: [workflow/agent-delegate.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L55)

##### taskOptions?

> `optional` **taskOptions?**: [`WorkflowSandboxPromptOptionsResolver`](#workflowsandboxpromptoptionsresolver)\<`TaskOptions`\>

Defined in: [workflow/agent-delegate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L56)

##### deleteAfter?

> `optional` **deleteAfter?**: `boolean`

Defined in: [workflow/agent-delegate.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L57)

##### includeEventsInTrace?

> `optional` **includeEventsInTrace?**: `boolean`

Defined in: [workflow/agent-delegate.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L58)

##### toTrace?

> `optional` **toTrace?**: (`trace`) => `unknown`

Defined in: [workflow/agent-delegate.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L59)

###### Parameters

###### trace

[`WorkflowSandboxAgentTrace`](#workflowsandboxagenttrace)\<`TOutput`\>

###### Returns

`unknown`

***

### WorkflowSandboxAgentDefaultTrace

Defined in: [workflow/agent-delegate.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L62)

#### Properties

##### stream

> **stream**: [`WorkflowSandboxAgentStream`](#workflowsandboxagentstream)

Defined in: [workflow/agent-delegate.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L63)

##### placement

> **placement**: `"sibling"` \| `"fleet"`

Defined in: [workflow/agent-delegate.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L64)

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [workflow/agent-delegate.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L65)

##### fleetId?

> `optional` **fleetId?**: `string`

Defined in: [workflow/agent-delegate.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L66)

##### machineId?

> `optional` **machineId?**: `string`

Defined in: [workflow/agent-delegate.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L67)

##### profileName?

> `optional` **profileName?**: `string`

Defined in: [workflow/agent-delegate.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L68)

##### eventCount

> **eventCount**: `number`

Defined in: [workflow/agent-delegate.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L69)

##### eventTypes

> **eventTypes**: `string`[]

Defined in: [workflow/agent-delegate.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L70)

##### events?

> `optional` **events?**: `SandboxEvent`[]

Defined in: [workflow/agent-delegate.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L71)

***

### CreateRunLoopWorkflowDelegateOptions

Defined in: [workflow/loop-delegate.ts:9](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/loop-delegate.ts#L9)

#### Type Parameters

##### Input

`Input`

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

#### Properties

##### toOutput?

> `optional` **toOutput?**: (`result`) => `unknown`

Defined in: [workflow/loop-delegate.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/loop-delegate.ts#L15)

###### Parameters

###### result

[`LoopResult`](runtime.md#loopresult)\<`Task`, `Output`, `Decision`\>

###### Returns

`unknown`

##### toTrace?

> `optional` **toTrace?**: (`result`) => `unknown`

Defined in: [workflow/loop-delegate.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/loop-delegate.ts#L16)

###### Parameters

###### result

[`LoopResult`](runtime.md#loopresult)\<`Task`, `Output`, `Decision`\>

###### Returns

`unknown`

#### Methods

##### toRunLoopOptions()

> **toRunLoopOptions**(`input`, `options`, `ctx`): [`RunLoopOptions`](runtime.md#runloopoptions)\<`Task`, `Output`, `Decision`\>

Defined in: [workflow/loop-delegate.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/loop-delegate.ts#L10)

###### Parameters

###### input

`Input`

###### options

[`WorkflowLoopOptions`](#workflowloopoptions)

###### ctx

[`WorkflowDelegateContext`](#workflowdelegatecontext)

###### Returns

[`RunLoopOptions`](runtime.md#runloopoptions)\<`Task`, `Output`, `Decision`\>

***

### NestedWorkflowDelegateInput

Defined in: [workflow/nested-workflow-delegate.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L17)

#### Properties

##### source

> **source**: `string`

Defined in: [workflow/nested-workflow-delegate.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L18)

##### options

> **options**: [`WorkflowAgentOptions`](#workflowagentoptions)

Defined in: [workflow/nested-workflow-delegate.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L19)

##### parent

> **parent**: [`WorkflowDelegateContext`](#workflowdelegatecontext)

Defined in: [workflow/nested-workflow-delegate.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L20)

***

### NestedWorkflowTrace

Defined in: [workflow/nested-workflow-delegate.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L31)

#### Properties

##### nested

> **nested**: `true`

Defined in: [workflow/nested-workflow-delegate.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L32)

##### runId

> **runId**: `string`

Defined in: [workflow/nested-workflow-delegate.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L33)

##### parentRunId

> **parentRunId**: `string`

Defined in: [workflow/nested-workflow-delegate.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L34)

##### depth

> **depth**: `number`

Defined in: [workflow/nested-workflow-delegate.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L35)

##### metaName

> **metaName**: `string`

Defined in: [workflow/nested-workflow-delegate.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L36)

##### eventCount

> **eventCount**: `number`

Defined in: [workflow/nested-workflow-delegate.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L37)

##### eventKinds

> **eventKinds**: `string`[]

Defined in: [workflow/nested-workflow-delegate.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L38)

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/nested-workflow-delegate.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L39)

##### costUsd

> **costUsd**: `number`

Defined in: [workflow/nested-workflow-delegate.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L40)

##### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](#workflowtokenusage)

Defined in: [workflow/nested-workflow-delegate.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L41)

##### agentCalls

> **agentCalls**: `number`

Defined in: [workflow/nested-workflow-delegate.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L42)

##### loopCalls

> **loopCalls**: `number`

Defined in: [workflow/nested-workflow-delegate.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L43)

##### events?

> `optional` **events?**: [`WorkflowTraceEvent`](#workflowtraceevent)[]

Defined in: [workflow/nested-workflow-delegate.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L44)

***

### CreateNestedWorkflowAgentDelegateOptions

Defined in: [workflow/nested-workflow-delegate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L47)

#### Properties

##### agent

> **agent**: [`WorkflowAgentDelegate`](#workflowagentdelegate)

Defined in: [workflow/nested-workflow-delegate.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L52)

Real worker delegate used for normal agent() calls and for child workflow
agent() calls that do not opt into allowWorkflow.

##### caps

> **caps**: [`NestedWorkflowCapsResolver`](#nestedworkflowcapsresolver)

Defined in: [workflow/nested-workflow-delegate.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L53)

##### loop?

> `optional` **loop?**: [`WorkflowLoopDelegate`](#workflowloopdelegate)

Defined in: [workflow/nested-workflow-delegate.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L54)

##### verifier?

> `optional` **verifier?**: [`WorkflowVerifierDelegate`](#workflowverifierdelegate)

Defined in: [workflow/nested-workflow-delegate.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L55)

##### analyst?

> `optional` **analyst?**: [`WorkflowAnalystDelegate`](#workflowanalystdelegate)

Defined in: [workflow/nested-workflow-delegate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L56)

##### reviewer?

> `optional` **reviewer?**: [`WorkflowReviewerDelegate`](#workflowreviewerdelegate)

Defined in: [workflow/nested-workflow-delegate.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L57)

##### metadata?

> `optional` **metadata?**: [`NestedWorkflowMetadataResolver`](#nestedworkflowmetadataresolver)

Defined in: [workflow/nested-workflow-delegate.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L58)

##### traceEmitter?

> `optional` **traceEmitter?**: [`WorkflowTraceEmitter`](#workflowtraceemitter)

Defined in: [workflow/nested-workflow-delegate.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L59)

##### includeEventsInTrace?

> `optional` **includeEventsInTrace?**: `boolean`

Defined in: [workflow/nested-workflow-delegate.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L60)

##### runId?

> `optional` **runId?**: (`input`) => `string`

Defined in: [workflow/nested-workflow-delegate.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L61)

###### Parameters

###### input

[`NestedWorkflowDelegateInput`](#nestedworkflowdelegateinput)

###### Returns

`string`

##### toOutput?

> `optional` **toOutput?**: (`result`, `input`) => `unknown`

Defined in: [workflow/nested-workflow-delegate.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L62)

###### Parameters

###### result

[`WorkflowResult`](#workflowresult)

###### input

[`NestedWorkflowDelegateInput`](#nestedworkflowdelegateinput)

###### Returns

`unknown`

##### toTrace?

> `optional` **toTrace?**: (`result`, `input`) => `unknown`

Defined in: [workflow/nested-workflow-delegate.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L63)

###### Parameters

###### result

[`WorkflowResult`](#workflowresult)

###### input

[`NestedWorkflowDelegateInput`](#nestedworkflowdelegateinput)

###### Returns

`unknown`

***

### WorkflowPhaseMeta

Defined in: [workflow/types.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L13)

**`Experimental`**

Dynamic workflow substrate.

A workflow is driver-authored code executed by a restricted runtime. The
runtime owns orchestration mechanics (phase/progress, fanout, budget,
cancellation, trace emission); product code supplies delegates that actually
run agents and loops. That boundary keeps this package generic while still
letting consumers wire real sandboxes underneath `agent()` and `loop()`.

#### Properties

##### title

> **title**: `string`

Defined in: [workflow/types.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L14)

**`Experimental`**

***

### WorkflowMeta

Defined in: [workflow/types.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L17)

#### Properties

##### name

> **name**: `string`

Defined in: [workflow/types.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L18)

##### description

> **description**: `string`

Defined in: [workflow/types.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L19)

##### phases?

> `optional` **phases?**: [`WorkflowPhaseMeta`](#workflowphasemeta)[]

Defined in: [workflow/types.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L20)

***

### WorkflowTokenUsage

Defined in: [workflow/types.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L37)

#### Properties

##### input

> **input**: `number`

Defined in: [workflow/types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L38)

##### output

> **output**: `number`

Defined in: [workflow/types.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L39)

***

### WorkflowBudgetSnapshot

Defined in: [workflow/types.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L42)

#### Properties

##### costUsd

> **costUsd**: `number`

Defined in: [workflow/types.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L43)

##### tokens

> **tokens**: [`WorkflowTokenUsage`](#workflowtokenusage)

Defined in: [workflow/types.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L44)

##### agentCalls

> **agentCalls**: `number`

Defined in: [workflow/types.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L45)

##### loopCalls

> **loopCalls**: `number`

Defined in: [workflow/types.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L46)

##### elapsedMs

> **elapsedMs**: `number`

Defined in: [workflow/types.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L47)

***

### WorkflowBudgetRemaining

Defined in: [workflow/types.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L50)

#### Properties

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [workflow/types.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L51)

##### tokens?

> `optional` **tokens?**: `number`

Defined in: [workflow/types.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L52)

##### agentCalls?

> `optional` **agentCalls?**: `number`

Defined in: [workflow/types.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L53)

##### loopCalls?

> `optional` **loopCalls?**: `number`

Defined in: [workflow/types.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L54)

##### wallMs?

> `optional` **wallMs?**: `number`

Defined in: [workflow/types.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L55)

***

### WorkflowBudgetCaps

Defined in: [workflow/types.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L58)

#### Properties

##### maxCostUsd?

> `optional` **maxCostUsd?**: `number`

Defined in: [workflow/types.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L59)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [workflow/types.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L60)

##### maxWallMs?

> `optional` **maxWallMs?**: `number`

Defined in: [workflow/types.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L61)

##### maxAgentCalls?

> `optional` **maxAgentCalls?**: `number`

Defined in: [workflow/types.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L62)

##### maxLoopCalls?

> `optional` **maxLoopCalls?**: `number`

Defined in: [workflow/types.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L63)

##### maxFanout?

> `optional` **maxFanout?**: `number`

Defined in: [workflow/types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L64)

##### maxDepth?

> `optional` **maxDepth?**: `number`

Defined in: [workflow/types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L65)

***

### WorkflowBudgetView

Defined in: [workflow/types.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L68)

#### Properties

##### total

> `readonly` **total**: [`WorkflowBudgetCaps`](#workflowbudgetcaps)

Defined in: [workflow/types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L69)

#### Methods

##### spent()

> **spent**(): [`WorkflowBudgetSnapshot`](#workflowbudgetsnapshot)

Defined in: [workflow/types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L70)

###### Returns

[`WorkflowBudgetSnapshot`](#workflowbudgetsnapshot)

##### remaining()

> **remaining**(): [`WorkflowBudgetRemaining`](#workflowbudgetremaining-1)

Defined in: [workflow/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L71)

###### Returns

[`WorkflowBudgetRemaining`](#workflowbudgetremaining-1)

***

### WorkflowAgentOptions

Defined in: [workflow/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L74)

#### Type Parameters

##### TOutput

`TOutput` = `unknown`

#### Properties

##### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L75)

##### schema?

> `optional` **schema?**: [`JsonSchema`](#jsonschema)

Defined in: [workflow/types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L76)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L77)

##### allowWorkflow?

> `optional` **allowWorkflow?**: `boolean`

Defined in: [workflow/types.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L82)

Nested workflows are denied by default. Consumers that expose them through
a delegate must also honor `ctx.depth` and `ctx.caps.maxDepth`.

##### decode?

> `optional` **decode?**: (`value`) => `TOutput`

Defined in: [workflow/types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L83)

###### Parameters

###### value

`unknown`

###### Returns

`TOutput`

***

### WorkflowLoopOptions

Defined in: [workflow/types.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L86)

#### Type Parameters

##### TOutput

`TOutput` = `unknown`

#### Properties

##### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L87)

##### schema?

> `optional` **schema?**: [`JsonSchema`](#jsonschema)

Defined in: [workflow/types.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L88)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L89)

##### decode?

> `optional` **decode?**: (`value`) => `TOutput`

Defined in: [workflow/types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L90)

###### Parameters

###### value

`unknown`

###### Returns

`TOutput`

***

### WorkflowCheckpointOptions

Defined in: [workflow/types.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L93)

#### Type Parameters

##### TOutput

`TOutput` = `unknown`

#### Properties

##### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L94)

##### schema?

> `optional` **schema?**: [`JsonSchema`](#jsonschema)

Defined in: [workflow/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L95)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L96)

##### decode?

> `optional` **decode?**: (`value`) => `TOutput`

Defined in: [workflow/types.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L97)

###### Parameters

###### value

`unknown`

###### Returns

`TOutput`

***

### WorkflowDelegateResult

Defined in: [workflow/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L100)

#### Properties

##### output

> **output**: `unknown`

Defined in: [workflow/types.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L101)

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [workflow/types.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L102)

##### tokenUsage?

> `optional` **tokenUsage?**: `Partial`\<[`WorkflowTokenUsage`](#workflowtokenusage)\>

Defined in: [workflow/types.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L103)

##### agentCalls?

> `optional` **agentCalls?**: `number`

Defined in: [workflow/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L105)

Additional downstream workflow agent calls consumed inside this delegate.

##### loopCalls?

> `optional` **loopCalls?**: `number`

Defined in: [workflow/types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L107)

Additional downstream workflow loop calls consumed inside this delegate.

##### trace?

> `optional` **trace?**: `unknown`

Defined in: [workflow/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L108)

***

### WorkflowDelegateContext

Defined in: [workflow/types.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L111)

#### Properties

##### workflowRunId

> **workflowRunId**: `string`

Defined in: [workflow/types.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L112)

##### depth

> **depth**: `number`

Defined in: [workflow/types.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L113)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L114)

##### signal

> **signal**: `AbortSignal`

Defined in: [workflow/types.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L115)

##### caps

> **caps**: [`WorkflowBudgetCaps`](#workflowbudgetcaps)

Defined in: [workflow/types.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L116)

##### budget

> **budget**: [`WorkflowBudgetView`](#workflowbudgetview)

Defined in: [workflow/types.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L117)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L118)

***

### WorkflowStartedPayload

Defined in: [workflow/types.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L290)

#### Properties

##### meta

> **meta**: [`WorkflowMeta`](#workflowmeta)

Defined in: [workflow/types.ts:291](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L291)

##### depth

> **depth**: `number`

Defined in: [workflow/types.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L292)

##### caps

> **caps**: [`WorkflowBudgetCaps`](#workflowbudgetcaps)

Defined in: [workflow/types.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L293)

***

### WorkflowPhasePayload

Defined in: [workflow/types.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L296)

#### Properties

##### title

> **title**: `string`

Defined in: [workflow/types.ts:297](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L297)

***

### WorkflowLogPayload

Defined in: [workflow/types.ts:300](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L300)

#### Properties

##### message

> **message**: `string`

Defined in: [workflow/types.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L301)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:302](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L302)

***

### WorkflowParallelStartedPayload

Defined in: [workflow/types.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L305)

#### Properties

##### branchCount

> **branchCount**: `number`

Defined in: [workflow/types.ts:306](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L306)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:307](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L307)

***

### WorkflowParallelEndedPayload

Defined in: [workflow/types.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L310)

#### Properties

##### branchCount

> **branchCount**: `number`

Defined in: [workflow/types.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L311)

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:312](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L312)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L313)

***

### WorkflowPipelineStartedPayload

Defined in: [workflow/types.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L316)

#### Properties

##### itemCount

> **itemCount**: `number`

Defined in: [workflow/types.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L317)

##### stageCount

> **stageCount**: `number`

Defined in: [workflow/types.ts:318](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L318)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:319](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L319)

***

### WorkflowPipelineEndedPayload

Defined in: [workflow/types.ts:322](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L322)

#### Properties

##### itemCount

> **itemCount**: `number`

Defined in: [workflow/types.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L323)

##### stageCount

> **stageCount**: `number`

Defined in: [workflow/types.ts:324](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L324)

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:325](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L325)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L326)

***

### WorkflowBranchStartedPayload

Defined in: [workflow/types.ts:331](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L331)

#### Properties

##### operation

> **operation**: [`WorkflowBranchOperation`](#workflowbranchoperation)

Defined in: [workflow/types.ts:332](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L332)

##### branchIndex

> **branchIndex**: `number`

Defined in: [workflow/types.ts:333](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L333)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:334](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L334)

##### stageCount?

> `optional` **stageCount?**: `number`

Defined in: [workflow/types.ts:335](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L335)

***

### WorkflowBranchEndedPayload

Defined in: [workflow/types.ts:338](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L338)

#### Properties

##### operation

> **operation**: [`WorkflowBranchOperation`](#workflowbranchoperation)

Defined in: [workflow/types.ts:339](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L339)

##### branchIndex

> **branchIndex**: `number`

Defined in: [workflow/types.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L340)

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:341](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L341)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:342](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L342)

##### stageCount?

> `optional` **stageCount?**: `number`

Defined in: [workflow/types.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L343)

***

### WorkflowBranchFailedPayload

Defined in: [workflow/types.ts:346](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L346)

#### Properties

##### operation

> **operation**: [`WorkflowBranchOperation`](#workflowbranchoperation)

Defined in: [workflow/types.ts:347](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L347)

##### branchIndex

> **branchIndex**: `number`

Defined in: [workflow/types.ts:348](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L348)

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:349](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L349)

##### message

> **message**: `string`

Defined in: [workflow/types.ts:350](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L350)

##### code?

> `optional` **code?**: `string`

Defined in: [workflow/types.ts:351](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L351)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:352](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L352)

##### stageIndex?

> `optional` **stageIndex?**: `number`

Defined in: [workflow/types.ts:353](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L353)

***

### WorkflowAgentStartedPayload

Defined in: [workflow/types.ts:356](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L356)

#### Properties

##### index

> **index**: `number`

Defined in: [workflow/types.ts:357](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L357)

##### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:358](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L358)

##### promptChars

> **promptChars**: `number`

Defined in: [workflow/types.ts:359](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L359)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:360](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L360)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:361](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L361)

***

### WorkflowAgentEndedPayload

Defined in: [workflow/types.ts:364](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L364)

#### Properties

##### index

> **index**: `number`

Defined in: [workflow/types.ts:365](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L365)

##### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:366](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L366)

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:367](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L367)

##### costUsd

> **costUsd**: `number`

Defined in: [workflow/types.ts:368](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L368)

##### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](#workflowtokenusage)

Defined in: [workflow/types.ts:369](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L369)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:370](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L370)

##### trace?

> `optional` **trace?**: `unknown`

Defined in: [workflow/types.ts:371](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L371)

***

### WorkflowLoopStartedPayload

Defined in: [workflow/types.ts:374](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L374)

#### Properties

##### index

> **index**: `number`

Defined in: [workflow/types.ts:375](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L375)

##### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:376](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L376)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:377](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L377)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:378](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L378)

***

### WorkflowLoopEndedPayload

Defined in: [workflow/types.ts:381](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L381)

#### Properties

##### index

> **index**: `number`

Defined in: [workflow/types.ts:382](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L382)

##### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:383](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L383)

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:384](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L384)

##### costUsd

> **costUsd**: `number`

Defined in: [workflow/types.ts:385](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L385)

##### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](#workflowtokenusage)

Defined in: [workflow/types.ts:386](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L386)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:387](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L387)

##### trace?

> `optional` **trace?**: `unknown`

Defined in: [workflow/types.ts:388](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L388)

***

### WorkflowCheckpointStartedPayload

Defined in: [workflow/types.ts:391](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L391)

#### Properties

##### index

> **index**: `number`

Defined in: [workflow/types.ts:392](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L392)

##### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:393](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L393)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:394](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L394)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:395](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L395)

***

### WorkflowCheckpointEndedPayload

Defined in: [workflow/types.ts:398](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L398)

#### Properties

##### index

> **index**: `number`

Defined in: [workflow/types.ts:399](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L399)

##### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:400](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L400)

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:401](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L401)

##### costUsd

> **costUsd**: `number`

Defined in: [workflow/types.ts:402](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L402)

##### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](#workflowtokenusage)

Defined in: [workflow/types.ts:403](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L403)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:404](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L404)

##### trace?

> `optional` **trace?**: `unknown`

Defined in: [workflow/types.ts:405](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L405)

***

### WorkflowFailedPayload

Defined in: [workflow/types.ts:417](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L417)

#### Properties

##### message

> **message**: `string`

Defined in: [workflow/types.ts:418](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L418)

##### code?

> `optional` **code?**: `string`

Defined in: [workflow/types.ts:419](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L419)

##### phase?

> `optional` **phase?**: `string`

Defined in: [workflow/types.ts:420](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L420)

***

### WorkflowEndedPayload

Defined in: [workflow/types.ts:423](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L423)

#### Properties

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:424](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L424)

##### costUsd

> **costUsd**: `number`

Defined in: [workflow/types.ts:425](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L425)

##### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](#workflowtokenusage)

Defined in: [workflow/types.ts:426](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L426)

##### agentCalls

> **agentCalls**: `number`

Defined in: [workflow/types.ts:427](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L427)

##### loopCalls

> **loopCalls**: `number`

Defined in: [workflow/types.ts:428](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L428)

***

### WorkflowTraceEmitter

Defined in: [workflow/types.ts:431](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L431)

#### Methods

##### emit()

> **emit**(`event`): `void` \| `Promise`\<`void`\>

Defined in: [workflow/types.ts:432](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L432)

###### Parameters

###### event

[`WorkflowTraceEvent`](#workflowtraceevent)

###### Returns

`void` \| `Promise`\<`void`\>

***

### WorkflowRuntimeOptions

Defined in: [workflow/types.ts:435](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L435)

#### Properties

##### source

> **source**: `string`

Defined in: [workflow/types.ts:436](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L436)

##### agent

> **agent**: [`WorkflowAgentDelegate`](#workflowagentdelegate)

Defined in: [workflow/types.ts:437](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L437)

##### loop?

> `optional` **loop?**: [`WorkflowLoopDelegate`](#workflowloopdelegate)

Defined in: [workflow/types.ts:438](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L438)

##### verifier?

> `optional` **verifier?**: [`WorkflowVerifierDelegate`](#workflowverifierdelegate)

Defined in: [workflow/types.ts:439](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L439)

##### analyst?

> `optional` **analyst?**: [`WorkflowAnalystDelegate`](#workflowanalystdelegate)

Defined in: [workflow/types.ts:440](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L440)

##### reviewer?

> `optional` **reviewer?**: [`WorkflowReviewerDelegate`](#workflowreviewerdelegate)

Defined in: [workflow/types.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L441)

##### runId?

> `optional` **runId?**: `string`

Defined in: [workflow/types.ts:442](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L442)

##### depth?

> `optional` **depth?**: `number`

Defined in: [workflow/types.ts:443](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L443)

##### caps?

> `optional` **caps?**: [`WorkflowBudgetCaps`](#workflowbudgetcaps)

Defined in: [workflow/types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L444)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:445](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L445)

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [workflow/types.ts:446](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L446)

##### traceEmitter?

> `optional` **traceEmitter?**: [`WorkflowTraceEmitter`](#workflowtraceemitter)

Defined in: [workflow/types.ts:447](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L447)

##### now?

> `optional` **now?**: () => `number`

Defined in: [workflow/types.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L448)

###### Returns

`number`

##### syncTimeoutMs?

> `optional` **syncTimeoutMs?**: `number`

Defined in: [workflow/types.ts:449](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L449)

***

### WorkflowResult

Defined in: [workflow/types.ts:452](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L452)

#### Type Parameters

##### TOutput

`TOutput` = `unknown`

#### Properties

##### runId

> **runId**: `string`

Defined in: [workflow/types.ts:453](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L453)

##### meta

> **meta**: [`WorkflowMeta`](#workflowmeta)

Defined in: [workflow/types.ts:454](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L454)

##### output

> **output**: `TOutput`

Defined in: [workflow/types.ts:455](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L455)

##### events

> **events**: [`WorkflowTraceEvent`](#workflowtraceevent)[]

Defined in: [workflow/types.ts:456](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L456)

##### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:457](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L457)

##### costUsd

> **costUsd**: `number`

Defined in: [workflow/types.ts:458](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L458)

##### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](#workflowtokenusage)

Defined in: [workflow/types.ts:459](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L459)

##### agentCalls

> **agentCalls**: `number`

Defined in: [workflow/types.ts:460](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L460)

##### loopCalls

> **loopCalls**: `number`

Defined in: [workflow/types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L461)

***

### ParsedWorkflowScript

Defined in: [workflow/validate.ts:5](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/validate.ts#L5)

#### Properties

##### meta

> **meta**: [`WorkflowMeta`](#workflowmeta)

Defined in: [workflow/validate.ts:6](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/validate.ts#L6)

##### body

> **body**: `string`

Defined in: [workflow/validate.ts:7](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/validate.ts#L7)

## Type Aliases

### WorkflowSandboxAgentStream

> **WorkflowSandboxAgentStream** = `"prompt"` \| `"task"`

Defined in: [workflow/agent-delegate.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L24)

***

### WorkflowSandboxAgentProfileResolver

> **WorkflowSandboxAgentProfileResolver** = `AgentProfile` \| ((`prompt`, `options`, `ctx`) => `AgentProfile`)

Defined in: [workflow/agent-delegate.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L26)

***

### WorkflowSandboxPromptOptionsResolver

> **WorkflowSandboxPromptOptionsResolver**\<`TOptions`\> = `TOptions` \| ((`prompt`, `options`, `ctx`) => `TOptions`)

Defined in: [workflow/agent-delegate.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L30)

#### Type Parameters

##### TOptions

`TOptions` *extends* `PromptOptions`

***

### NestedWorkflowCapsResolver

> **NestedWorkflowCapsResolver** = [`WorkflowBudgetCaps`](#workflowbudgetcaps) \| ((`input`) => [`WorkflowBudgetCaps`](#workflowbudgetcaps))

Defined in: [workflow/nested-workflow-delegate.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L23)

***

### NestedWorkflowMetadataResolver

> **NestedWorkflowMetadataResolver** = `Record`\<`string`, `unknown`\> \| ((`input`) => `Record`\<`string`, `unknown`\> \| `undefined`)

Defined in: [workflow/nested-workflow-delegate.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L27)

***

### JsonSchema

> **JsonSchema** = \{ `type`: `"string"`; `minLength?`: `number`; `maxLength?`: `number`; `enum?`: `string`[]; \} \| \{ `type`: `"number"`; `minimum?`: `number`; `maximum?`: `number`; `enum?`: `number`[]; \} \| \{ `type`: `"integer"`; `minimum?`: `number`; `maximum?`: `number`; `enum?`: `number`[]; \} \| \{ `type`: `"boolean"`; `enum?`: `boolean`[]; \} \| \{ `type`: `"null"`; \} \| \{ `type`: `"array"`; `items?`: [`JsonSchema`](#jsonschema); `minItems?`: `number`; `maxItems?`: `number`; \} \| \{ `type`: `"object"`; `properties?`: `Record`\<`string`, [`JsonSchema`](#jsonschema)\>; `required?`: `string`[]; `additionalProperties?`: `boolean`; \}

Defined in: [workflow/types.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L23)

***

### WorkflowAgentDelegate

> **WorkflowAgentDelegate** = (`prompt`, `options`, `ctx`) => `Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

Defined in: [workflow/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L121)

#### Parameters

##### prompt

`string`

##### options

[`WorkflowAgentOptions`](#workflowagentoptions)

##### ctx

[`WorkflowDelegateContext`](#workflowdelegatecontext)

#### Returns

`Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

***

### WorkflowLoopDelegate

> **WorkflowLoopDelegate** = (`input`, `options`, `ctx`) => `Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

Defined in: [workflow/types.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L127)

#### Parameters

##### input

`unknown`

##### options

[`WorkflowLoopOptions`](#workflowloopoptions)

##### ctx

[`WorkflowDelegateContext`](#workflowdelegatecontext)

#### Returns

`Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

***

### WorkflowVerifierDelegate

> **WorkflowVerifierDelegate** = (`input`, `options`, `ctx`) => `Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

Defined in: [workflow/types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L133)

#### Parameters

##### input

`unknown`

##### options

[`WorkflowCheckpointOptions`](#workflowcheckpointoptions)

##### ctx

[`WorkflowDelegateContext`](#workflowdelegatecontext)

#### Returns

`Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

***

### WorkflowAnalystDelegate

> **WorkflowAnalystDelegate** = (`input`, `options`, `ctx`) => `Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

Defined in: [workflow/types.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L139)

#### Parameters

##### input

`unknown`

##### options

[`WorkflowCheckpointOptions`](#workflowcheckpointoptions)

##### ctx

[`WorkflowDelegateContext`](#workflowdelegatecontext)

#### Returns

`Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

***

### WorkflowReviewerDelegate

> **WorkflowReviewerDelegate** = (`input`, `options`, `ctx`) => `Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

Defined in: [workflow/types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L145)

#### Parameters

##### input

`unknown`

##### options

[`WorkflowCheckpointOptions`](#workflowcheckpointoptions)

##### ctx

[`WorkflowDelegateContext`](#workflowdelegatecontext)

#### Returns

`Promise`\<[`WorkflowDelegateResult`](#workflowdelegateresult)\>

***

### WorkflowTraceEvent

> **WorkflowTraceEvent** = \{ `kind`: `"workflow.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowStartedPayload`](#workflowstartedpayload); \} \| \{ `kind`: `"workflow.phase"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowPhasePayload`](#workflowphasepayload); \} \| \{ `kind`: `"workflow.log"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowLogPayload`](#workflowlogpayload); \} \| \{ `kind`: `"workflow.parallel.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowParallelStartedPayload`](#workflowparallelstartedpayload); \} \| \{ `kind`: `"workflow.parallel.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowParallelEndedPayload`](#workflowparallelendedpayload); \} \| \{ `kind`: `"workflow.pipeline.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowPipelineStartedPayload`](#workflowpipelinestartedpayload); \} \| \{ `kind`: `"workflow.pipeline.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowPipelineEndedPayload`](#workflowpipelineendedpayload); \} \| \{ `kind`: `"workflow.branch.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowBranchStartedPayload`](#workflowbranchstartedpayload); \} \| \{ `kind`: `"workflow.branch.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowBranchEndedPayload`](#workflowbranchendedpayload); \} \| \{ `kind`: `"workflow.branch.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowBranchFailedPayload`](#workflowbranchfailedpayload); \} \| \{ `kind`: `"workflow.agent.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowAgentStartedPayload`](#workflowagentstartedpayload); \} \| \{ `kind`: `"workflow.agent.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowAgentEndedPayload`](#workflowagentendedpayload); \} \| \{ `kind`: `"workflow.agent.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: `WorkflowDelegateFailedPayload`; \} \| \{ `kind`: `"workflow.loop.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowLoopStartedPayload`](#workflowloopstartedpayload); \} \| \{ `kind`: `"workflow.loop.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowLoopEndedPayload`](#workflowloopendedpayload); \} \| \{ `kind`: `"workflow.loop.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: `WorkflowDelegateFailedPayload`; \} \| \{ `kind`: `"workflow.verifier.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowCheckpointStartedPayload`](#workflowcheckpointstartedpayload); \} \| \{ `kind`: `"workflow.verifier.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowCheckpointEndedPayload`](#workflowcheckpointendedpayload); \} \| \{ `kind`: `"workflow.verifier.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: `WorkflowDelegateFailedPayload`; \} \| \{ `kind`: `"workflow.analyst.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowCheckpointStartedPayload`](#workflowcheckpointstartedpayload); \} \| \{ `kind`: `"workflow.analyst.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowCheckpointEndedPayload`](#workflowcheckpointendedpayload); \} \| \{ `kind`: `"workflow.analyst.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: `WorkflowDelegateFailedPayload`; \} \| \{ `kind`: `"workflow.reviewer.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowCheckpointStartedPayload`](#workflowcheckpointstartedpayload); \} \| \{ `kind`: `"workflow.reviewer.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowCheckpointEndedPayload`](#workflowcheckpointendedpayload); \} \| \{ `kind`: `"workflow.reviewer.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: `WorkflowDelegateFailedPayload`; \} \| \{ `kind`: `"workflow.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowFailedPayload`](#workflowfailedpayload); \} \| \{ `kind`: `"workflow.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`WorkflowEndedPayload`](#workflowendedpayload); \}

Defined in: [workflow/types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L151)

***

### WorkflowBranchOperation

> **WorkflowBranchOperation** = `"parallel"` \| `"pipeline"`

Defined in: [workflow/types.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L329)

## Functions

### createSandboxWorkflowAgentDelegate()

> **createSandboxWorkflowAgentDelegate**\<`TOutput`\>(`options`): [`WorkflowAgentDelegate`](#workflowagentdelegate)

Defined in: [workflow/agent-delegate.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L74)

#### Type Parameters

##### TOutput

`TOutput` = `unknown`

#### Parameters

##### options

[`CreateSandboxWorkflowAgentDelegateOptions`](#createsandboxworkflowagentdelegateoptions)\<`TOutput`\>

#### Returns

[`WorkflowAgentDelegate`](#workflowagentdelegate)

***

### parseSandboxAgentDefaultOutput()

> **parseSandboxAgentDefaultOutput**(`events`): `unknown`

Defined in: [workflow/agent-delegate.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L147)

#### Parameters

##### events

`SandboxEvent`[]

#### Returns

`unknown`

***

### createRunLoopWorkflowDelegate()

> **createRunLoopWorkflowDelegate**\<`Input`, `Task`, `Output`, `Decision`\>(`options`): [`WorkflowLoopDelegate`](#workflowloopdelegate)

Defined in: [workflow/loop-delegate.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/loop-delegate.ts#L19)

#### Type Parameters

##### Input

`Input`

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

#### Parameters

##### options

[`CreateRunLoopWorkflowDelegateOptions`](#createrunloopworkflowdelegateoptions)\<`Input`, `Task`, `Output`, `Decision`\>

#### Returns

[`WorkflowLoopDelegate`](#workflowloopdelegate)

***

### createNestedWorkflowAgentDelegate()

> **createNestedWorkflowAgentDelegate**(`options`): [`WorkflowAgentDelegate`](#workflowagentdelegate)

Defined in: [workflow/nested-workflow-delegate.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L66)

#### Parameters

##### options

[`CreateNestedWorkflowAgentDelegateOptions`](#createnestedworkflowagentdelegateoptions)

#### Returns

[`WorkflowAgentDelegate`](#workflowagentdelegate)

***

### runWorkflow()

> **runWorkflow**\<`TOutput`\>(`options`): `Promise`\<[`WorkflowResult`](#workflowresult)\<`TOutput`\>\>

Defined in: [workflow/runtime.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/runtime.ts#L36)

#### Type Parameters

##### TOutput

`TOutput` = `unknown`

#### Parameters

##### options

[`WorkflowRuntimeOptions`](#workflowruntimeoptions)

#### Returns

`Promise`\<[`WorkflowResult`](#workflowresult)\<`TOutput`\>\>

***

### validateJsonSchema()

> **validateJsonSchema**(`value`, `schema`, `path?`): `void`

Defined in: [workflow/schema.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/schema.ts#L68)

#### Parameters

##### value

`unknown`

##### schema

[`JsonSchema`](#jsonschema)

##### path?

`string` = `'$'`

#### Returns

`void`

***

### parseWorkflowScript()

> **parseWorkflowScript**(`source`): [`ParsedWorkflowScript`](#parsedworkflowscript)

Defined in: [workflow/validate.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/validate.ts#L53)

#### Parameters

##### source

`string`

#### Returns

[`ParsedWorkflowScript`](#parsedworkflowscript)

***

### validateWorkflowBody()

> **validateWorkflowBody**(`body`): `void`

Defined in: [workflow/validate.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/validate.ts#L71)

#### Parameters

##### body

`string`

#### Returns

`void`
