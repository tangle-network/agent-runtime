[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CreateScopeAnalystOptions

# Interface: CreateScopeAnalystOptions\<D\>

Defined in: [runtime/personify/analyst.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L68)

The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far.
The combinator supplies the analyst's task projection (how to frame the drained settlements as
the analyst's input) — the analyst's `act` reads the trace and returns its raw findings; the
firewall is enforced afterwards by `createScopeAnalyst`, not by the analyst itself.

## Type Parameters

### D

`D`

## Properties

### analyst

> `readonly` **analyst**: [`Agent`](Agent.md)\<`unknown`, readonly `AnalystFinding`[]\>

Defined in: [runtime/personify/analyst.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L72)

The analyst agent the combinator spawns over the trace. `harness` is the persona's choice
 (`null` for an inline router analyst, a `BackendType` for a sandboxed one). Its `act` returns
 the RAW findings; this module asserts the firewall on them before returning.

***

### budget

> `readonly` **budget**: [`Budget`](Budget.md)

Defined in: [runtime/personify/analyst.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L78)

The conserved budget reserved for one analyst spawn. The pool reserves against it and fails
 closed; an analyst that cannot be admitted is a fail-loud abort, never silent empty findings.

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [runtime/personify/analyst.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L80)

Trace/journal label for the spawned analyst child. Default `'analyst'`.

## Methods

### buildTask()

> **buildTask**(`input`): `unknown`

Defined in: [runtime/personify/analyst.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L75)

Build the analyst agent's task from the analyze input (the root-task framing + the children
 drained so far). Pure projection — the analyst interprets it, this never reads it.

#### Parameters

##### input

[`ScopeAnalyzeInput`](ScopeAnalyzeInput.md)\<`D`\>

#### Returns

`unknown`
