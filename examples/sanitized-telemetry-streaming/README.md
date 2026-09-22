# Redacted runtime telemetry

`createRuntimeStreamEventCollector()` records event types, usage, status, and text lengths without recording prompts, streamed text, tool payloads, or error bodies.

```ts
const collector = createRuntimeStreamEventCollector()

for await (const event of streamAgentTurn(target, prompt)) {
  collector.onEvent(event)
}

console.log(collector.summary())
```

There are three explicit opt-ins:

| Option | Adds |
|---|---|
| `includeTaskData` | Task intent and inputs |
| `includeEventData` | Text, tool arguments and results, artifacts, proposals, and error details |
| `includeMetadata` | Task, artifact, and final metadata |

Use opt-ins only for sinks allowed to store that data.

Run the offline example:

```bash
pnpm tsx examples/sanitized-telemetry-streaming/sanitized-telemetry-streaming.ts
```
