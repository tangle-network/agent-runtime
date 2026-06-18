[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Persona

# Interface: Persona\<D\>

Defined in: [runtime/personify/types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L70)

The "act like X" record. A thin composition over the keystone's `AgentSpec`: it pairs the
root spec (the executor mapping for the root agent the shape builds) with the CONTENT a
shape consumes — the goal framing (`directive`) and who the loop is acting as (`context`).

The framework never reads `directive`/`context` semantically; it threads them to the shape
verbatim through `ShapeContext`. This is the rule the mandate names: the FRAMEWORK is
structure, the PERSONA carries model/prompt/tools/directive. No model name, prompt, or
persona string is ever hardcoded in a shape or the engine.

`D` is the deliverable type this persona's loops produce; it flows into `Outcome<D>`.

## Type Parameters

### D

`D` = `unknown`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [runtime/personify/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L72)

Stable persona name — used as the trace/journal label root, never as content.

***

### root

> `readonly` **root**: [`AgentSpec`](AgentSpec.md)

Defined in: [runtime/personify/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L78)

The root agent's executor mapping (profile + harness + optional BYO executor). The
shape's root `Agent` carries THIS as its `executorSpec`; child specs the shape spawns
are derived from / resolved against the same persona registry (see `ShapeContext`).

***

### directive

> `readonly` **directive**: `string`

Defined in: [runtime/personify/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L80)

The goal framing handed to the shape — the "what to achieve", not "how".

***

### context

> `readonly` **context**: [`PersonaContext`](PersonaContext.md)

Defined in: [runtime/personify/types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L83)

Who the loop is acting as — the opaque persona context blob the shape may inject into
 child tasks. Opaque to the framework; only the persona's profiles/prompts interpret it.

***

### executors

> `readonly` **executors**: [`PersonaExecutors`](PersonaExecutors.md)

Defined in: [runtime/personify/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L91)

The executor seams (router endpoint+key, sandbox client, cli bin) the built-in runtimes
read off `ExecutorContext.seams`, OR a fully pre-configured registry. The supervisor
threads an EMPTY seam bag to the root scope, so a persona that uses built-in metered
runtimes MUST supply a registry whose factories close over their seams (or BYO executors
on each `AgentSpec`). Carried here so `runPersonified` can build `SupervisorOpts.executors`.

***

### extensions?

> `readonly` `optional` **extensions?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [runtime/personify/types.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L96)

Forward-compatible extension bag — a later world-model / memory / tool-budget field is an
additive key here, never a breaking change to the `Persona` shape. Opaque to the engine.

***

### \_\_deliverable?

> `readonly` `optional` **\_\_deliverable?**: `D`

Defined in: [runtime/personify/types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L99)

Phantom: binds the persona to its deliverable type so `runPersonified` infers `D` from
 the persona and the chosen shape must agree. Type-only — never present at runtime.
