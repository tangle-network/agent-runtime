[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AssertTraceDerivedFindings

# Type Alias: AssertTraceDerivedFindings

> **AssertTraceDerivedFindings** = (`findings`) => `void`

Defined in: [runtime/personify/wave-types.ts:401](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L401)

The firewall assertion contract, re-stated for the reactive seam (PORT of
`assertTraceDerivedFindings`). A PROVENANCE check, not a content check: span/event/artifact/
finding refs and empty-evidence findings pass; only a `metric` ref whose uri is a
judge/verdict/score scheme is rejected. Fail loud — a tainted finding aborts. The impl lives in
`analyst.ts`; this type pins its signature so callers depend on the contract, not the impl.

## Parameters

### findings

`ReadonlyArray`\<`AnalystFinding`\>

## Returns

`void`
