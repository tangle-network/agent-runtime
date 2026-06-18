[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / applyRunRecordDefaults

# Function: applyRunRecordDefaults()

> **applyRunRecordDefaults**(`records`, `scenarioId`, `controlFailureClass`): `RunRecord`[]

Defined in: [run.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L48)

Stamp cross-cutting defaults onto adapter-projected RunRecords without
 overriding anything the adapter set explicitly:
  - `scenarioId` — the run's scenario, when the record omits one.
  - `failureClass` — the control layer's failure classification promoted
    onto the canonical cross-agent key, but ONLY when it's a real taxonomy
    class. This is what lets the substrate aggregate failures across every
    agent in one vocabulary instead of per-agent ad-hoc strings.

## Parameters

### records

`RunRecord`[]

### scenarioId

`string`

### controlFailureClass

`string` \| `undefined`

## Returns

`RunRecord`[]
