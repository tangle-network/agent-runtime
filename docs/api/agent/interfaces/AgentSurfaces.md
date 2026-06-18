[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / AgentSurfaces

# Interface: AgentSurfaces

Defined in: [agent/surfaces.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L37)

Surface declarations. Every path is repo-relative (or absolute) at
`defineAgent` time. At resolution time, paths are joined against the
agent's `repoRoot`.

`systemPrompt`, `tools`, `personas` are DIRECTORIES; the loop appends
`<section>.md`, `<tool>/README.md`, `<persona-id>.yaml` etc.
`rubric`, `outputSchema` are SINGLE FILES; the loop edits them in
place.

`knowledge` is the agent-knowledge root (typically `.agent-knowledge`);
`applyKnowledgeWriteBlocks` writes pages relative to it.

Optional surfaces (`scaffolding`, `memory`, `rag`, `outputSchema`)
can be omitted — the loop will reject findings targeting them with a
clear log message instead of fabricating a path.

## Properties

### systemPrompt

> **systemPrompt**: `string`

Defined in: [agent/surfaces.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L39)

Directory containing one markdown file per system-prompt section.

***

### tools

> **tools**: `string`

Defined in: [agent/surfaces.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L41)

Directory containing one subdir per tool (`<tool>/README.md`).

***

### rubric

> **rubric**: `string`

Defined in: [agent/surfaces.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L43)

Single file (TypeScript module) defining the rubric weights + dimensions.

***

### knowledge

> **knowledge**: `string`

Defined in: [agent/surfaces.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L45)

Knowledge-base root; typically `.agent-knowledge`.

***

### personas

> **personas**: `string`

Defined in: [agent/surfaces.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L47)

Directory containing one YAML/JSON file per persona.

***

### scaffolding?

> `optional` **scaffolding?**: `string`

Defined in: [agent/surfaces.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L49)

Optional: directory containing scaffolding rules (precondition checks, retry policies).

***

### memory?

> `optional` **memory?**: `string`

Defined in: [agent/surfaces.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L51)

Optional: memory store path (JSONL / SQLite / DB).

***

### rag?

> `optional` **rag?**: `string`

Defined in: [agent/surfaces.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L53)

Optional: directory containing RAG corpora (`<corpus>/<doc-id>.md`).

***

### outputSchema?

> `optional` **outputSchema?**: `string`

Defined in: [agent/surfaces.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L55)

Optional: single file defining the output schema (Zod / JSON Schema).
