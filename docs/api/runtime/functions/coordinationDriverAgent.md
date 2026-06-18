[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / coordinationDriverAgent

# Function: coordinationDriverAgent()

> **coordinationDriverAgent**(`opts`): [`Agent`](../interfaces/Agent.md)\<`unknown`, `unknown`\>

Defined in: [runtime/supervise/coordination-driver.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L124)

Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
`driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.

## Parameters

### opts

[`CoordinationDriverOptions`](../interfaces/CoordinationDriverOptions.md)

## Returns

[`Agent`](../interfaces/Agent.md)\<`unknown`, `unknown`\>
