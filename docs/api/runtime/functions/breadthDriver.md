[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / breadthDriver

# Function: breadthDriver()

> **breadthDriver**(`_surface`, `task`, `opts`, `cfg`): [`Agent`](../interfaces/Agent.md)\<`unknown`, [`Outcome`](../type-aliases/Outcome.md)\<`unknown`\>\>

Defined in: [runtime/strategy.ts:595](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L595)

BREADTH: K independent rollouts (each own artifact), verifier picks the best.

## Parameters

### \_surface

[`AgenticSurface`](../interfaces/AgenticSurface.md)

### task

[`AgenticTask`](../interfaces/AgenticTask.md)

### opts

[`AgenticOptions`](../interfaces/AgenticOptions.md)

### cfg

#### width

`number`

## Returns

[`Agent`](../interfaces/Agent.md)\<`unknown`, [`Outcome`](../type-aliases/Outcome.md)\<`unknown`\>\>
