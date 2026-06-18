[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / AgentKnowledgeProvider

# Interface: AgentKnowledgeProvider

Defined in: [types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L38)

## Stable

## Methods

### buildReadiness()?

> `optional` **buildReadiness**(`task`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

Defined in: [types.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L39)

#### Parameters

##### task

[`AgentTaskSpec`](AgentTaskSpec.md)

#### Returns

`KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

***

### answerQuestions()?

> `optional` **answerQuestions**(`questions`, `task`): `Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

Defined in: [types.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L40)

#### Parameters

##### questions

`UserQuestion`[]

##### task

[`AgentTaskSpec`](AgentTaskSpec.md)

#### Returns

`Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

***

### executeAcquisitionPlans()?

> `optional` **executeAcquisitionPlans**(`plans`, `task`): `string`[] \| `Promise`\<`string`[]\>

Defined in: [types.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L44)

#### Parameters

##### plans

`DataAcquisitionPlan`[]

##### task

[`AgentTaskSpec`](AgentTaskSpec.md)

#### Returns

`string`[] \| `Promise`\<`string`[]\>

***

### refreshReadiness()?

> `optional` **refreshReadiness**(`input`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

Defined in: [types.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L48)

#### Parameters

##### input

###### task

[`AgentTaskSpec`](AgentTaskSpec.md)

###### previous

`KnowledgeReadinessReport`

###### userAnswers

`Record`\<`string`, `string`\>

###### acquiredEvidenceIds

`string`[]

#### Returns

`KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>
