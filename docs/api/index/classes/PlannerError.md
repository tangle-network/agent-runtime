[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / PlannerError

# Class: PlannerError

Defined in: [errors.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L111)

## Stable

The dynamic-loop planner returned an unusable topology move — the LLM emitted
no parseable envelope, an unknown `kind`, or a structurally-invalid move
(e.g. a fanout with zero tasks). This is a structural failure of the
agent-authored topology, not a config mistake: the planner ran but its output
cannot drive the kernel. Carries `validation` so cross-package handlers can
pattern-match without importing the runtime. Fail loud — never substitute a
default move, or the loop silently runs a topology nobody chose.

## Extends

- `AgentEvalError`

## Constructors

### Constructor

> **new PlannerError**(`message`, `options?`): `PlannerError`

Defined in: [errors.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L112)

#### Parameters

##### message

`string`

##### options?

###### cause?

`unknown`

#### Returns

`PlannerError`

#### Overrides

`AgentEvalError.constructor`
