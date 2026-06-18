[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ResearchLoopResult

# Interface: ResearchLoopResult

Defined in: [loop-runner.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L250)

**`Experimental`**

## Properties

### accepted

> **accepted**: [`FactCandidate`](../../mcp/interfaces/FactCandidate.md)[]

Defined in: [loop-runner.ts:252](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L252)

**`Experimental`**

Facts that passed the fail-closed gate — safe to write to the KB.

***

### vetoed

> **vetoed**: [`VetoedFact`](VetoedFact.md)[]

Defined in: [loop-runner.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L254)

**`Experimental`**

Facts the gate vetoed in the final round — escalate, do not silently drop.

***

### rounds

> **rounds**: `number`

Defined in: [loop-runner.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L256)

**`Experimental`**

Research rounds actually run.
