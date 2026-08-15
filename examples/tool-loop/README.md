# Run a tool-calling turn

## When to use it

Use this when the model must call your tools and then answer in the same turn.
The loop runs one model turn, executes each requested tool, folds the results back, and runs the turn again.
It stops when the model finishes, or when a turn cap, a deadline, a cost limit, or a stuck-loop check fires.

Use a sibling instead when the shape is different.

| Your shape | Use |
|---|---|
| One turn with no tool round trip | [`../stream-a-turn`](../stream-a-turn) |
| One turn served over HTTP and saved | [`../chat-handler`](../chat-handler) |
| Several worker attempts under your own stop rule | [`../quickstart`](../quickstart) |
| One agent that spawns other agents | [`../supervise`](../supervise) |

## How to use it

```bash
pnpm build && pnpm tsx examples/tool-loop/tool-loop.ts
```

The example runs offline and needs no credentials.
It prints:

```text
Looking up the invoice.
Invoice inv-42 is $120 and already paid.
tool get_invoice → ok
turns: 2 — stopReason: completed
```

Read [`tool-loop.ts`](./tool-loop.ts) for the whole file.
You supply two functions and the loop owns the rest.

```ts
const result = await runToolLoop({
  systemPrompt: 'You answer billing questions. Use the tools before you answer.',
  userMessage: 'Is invoice inv-42 paid?',
  streamTurn, // one model turn: yields text and tool calls
  executeToolCall, // your executors: one call in, one typed outcome out
  isExecutableTool: (name) => tools.some((tool) => tool.function.name === name),
  maxToolTurns: 8,
})
```

Read `result.stopReason` before you score the turn.
Only `completed` means the model finished; `stuck-loop`, `backstop`, `deadline`, and `budget` are resource outcomes.

## Why this exists

Every agent product writes this loop, and the hard parts are the same each time.
The loop keeps the OpenAI tool history correct, so a strict model reads its own tool use back instead of repeating the call.
A tool failure returns a typed outcome instead of throwing, so the model reads the reason and can recover.
