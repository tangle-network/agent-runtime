[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / assertStrategyContract

# Function: assertStrategyContract()

> **assertStrategyContract**(`code`): `void`

Defined in: [runtime/strategy-author.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L114)

Static CONTRACT lint over an authored strategy module — the module-boundary
 enforcement of the harness's two measurement invariants:
   - author blindness: the only import allowed is the loops surface. A body that could
     reach the filesystem, network, or process could read or mutate verifier/artifact
     state outside the brokered shots, and the harness-verified score would stop
     meaning "what the shots achieved".
   - conserved dose: no out-of-band compute (fetch/require/eval) — every unit a
     strategy spends is metered by the Supervisor's pool, which is what makes
     equal-budget comparisons between strategies valid.
 A lint, not a sandbox: its job is keeping the benchmark numbers interpretable.

## Parameters

### code

`string`

## Returns

`void`
