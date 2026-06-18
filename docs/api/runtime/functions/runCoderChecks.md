[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / runCoderChecks

# Function: runCoderChecks()

> **runCoderChecks**(`input`, `constraints?`): `DefaultVerdict`

Defined in: [runtime/supervise/patch-checks.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L96)

**`Experimental`**

The pure mechanical gate — the SINGLE source of the no-op / always-on secret-path floor /
diff-size / forbidden-path / test / typecheck checks. No I/O: it scores a patch + its
already-derived pass signals.

Checks in order: (1) no-op rejection, (2) always-on secret-path floor (independent of
`forbiddenPaths`), (3) forbidden-path, (4) diff-size cap, (5) tests, (6) typecheck.
Aggregate score: `0.5*tests + 0.3*typecheck + 0.2*(1 - diffLines/maxDiff)`; `valid` is the
conjunction of all six.

## Parameters

### input

[`CoderCheckInput`](../interfaces/CoderCheckInput.md)

### constraints?

[`CoderCheckConstraints`](../interfaces/CoderCheckConstraints.md) = `{}`

## Returns

`DefaultVerdict`
