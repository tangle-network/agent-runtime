[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / QuestionRecord

# Interface: QuestionRecord

Defined in: [mcp/tools/coordination.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L53)

## Extends

- [`Question`](Question.md)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/coordination.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L39)

#### Inherited from

[`Question`](Question.md).[`id`](Question.md#id)

***

### from

> `readonly` **from**: `string`

Defined in: [mcp/tools/coordination.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L40)

#### Inherited from

[`Question`](Question.md).[`from`](Question.md#from)

***

### level

> `readonly` **level**: `QuestionLevel`

Defined in: [mcp/tools/coordination.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L41)

#### Inherited from

[`Question`](Question.md).[`level`](Question.md#level)

***

### question

> `readonly` **question**: `string`

Defined in: [mcp/tools/coordination.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L42)

#### Inherited from

[`Question`](Question.md).[`question`](Question.md#question)

***

### reason

> `readonly` **reason**: `string`

Defined in: [mcp/tools/coordination.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L43)

#### Inherited from

[`Question`](Question.md).[`reason`](Question.md#reason)

***

### urgency

> `readonly` **urgency**: `QuestionUrgency`

Defined in: [mcp/tools/coordination.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L44)

#### Inherited from

[`Question`](Question.md).[`urgency`](Question.md#urgency)

***

### options?

> `readonly` `optional` **options?**: readonly `QuestionOption`[]

Defined in: [mcp/tools/coordination.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L45)

#### Inherited from

[`Question`](Question.md).[`options`](Question.md#options)

***

### status

> `readonly` **status**: `"open"` \| `"answered"` \| `"deferred"` \| `"escalated"`

Defined in: [mcp/tools/coordination.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L54)

***

### decision?

> `readonly` `optional` **decision?**: [`QuestionDecision`](../type-aliases/QuestionDecision.md)

Defined in: [mcp/tools/coordination.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L55)

***

### openedAt

> `readonly` **openedAt**: `number`

Defined in: [mcp/tools/coordination.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L56)
