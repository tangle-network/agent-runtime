[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RegistryAnalyzeProjection

# Interface: RegistryAnalyzeProjection

Defined in: [runtime/personify/analyst.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L183)

Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a
`runId` + `AnalystRunInputs` (a trace store / run record / artifact dir), NOT in-memory scope
settlements — so the CALLER owns the projection from the combinator's drained children to the
registry's inputs (e.g. the trace store the run already wrote). This adapter never invents that
bridge; it only runs the projected inputs and firewalls the merged findings.

## Properties

### runId

> `readonly` **runId**: `string`

Defined in: [runtime/personify/analyst.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L184)

***

### inputs

> `readonly` **inputs**: `AnalystRunInputs`

Defined in: [runtime/personify/analyst.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L185)

***

### opts?

> `readonly` `optional` **opts?**: `object`

Defined in: [runtime/personify/analyst.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L187)

Optional `run` opts (e.g. `priorFindings`) forwarded verbatim to the registry.

#### Index Signature

\[`k`: `string`\]: `unknown`

#### priorFindings?

> `optional` **priorFindings?**: readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>
