[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / WorkflowPhaseMeta

# Interface: WorkflowPhaseMeta

Defined in: [workflow/types.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L13)

**`Experimental`**

Dynamic workflow substrate.

A workflow is driver-authored code executed by a restricted runtime. The
runtime owns orchestration mechanics (phase/progress, fanout, budget,
cancellation, trace emission); product code supplies delegates that actually
run agents and loops. That boundary keeps this package generic while still
letting consumers wire real sandboxes underneath `agent()` and `loop()`.

## Properties

### title

> **title**: `string`

Defined in: [workflow/types.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L14)

**`Experimental`**
