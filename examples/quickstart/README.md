# Run a scripted loop

## When to use it

Use this when one prompt is not enough, and you must run several attempts under your own rules.
A driver runs a worker, reads its output, and writes the next prompt until a check passes.
You own the rules: `plan` returns the tasks to run this iteration, and `decide` says whether the loop continues.

Use a sibling instead when the shape is different.

| Your shape | Use |
|---|---|
| One turn, read the events yourself | [`../stream-a-turn`](../stream-a-turn) |
| One turn where the model calls your tools | [`../tool-loop`](../tool-loop) |
| A model decides what to do next, not your code | [`../supervise`](../supervise) |
| A job that must outlive your process | [`../retained-run`](../retained-run) |

## How to use it

Two files, both offline and deterministic.
The worker is a scripted stand-in, so neither needs credentials.

```bash
pnpm build
pnpm tsx examples/quickstart/minimal.ts      # the smallest call the types accept
pnpm tsx examples/quickstart/quickstart.ts   # the same call, refining until a check passes
```

[`minimal.ts`](./minimal.ts) is the root README quickstart, kept compiling by `pnpm typecheck:examples`.
It prints:

```text
decision: done — 1 iteration(s)
```

[`quickstart.ts`](./quickstart.ts) adds the fold: it reads the last output and writes the next prompt from it.

```ts
plan: async (task, history) => {
  const last = history[history.length - 1]
  if (!last) return [task] // shot 0: run the task as written
  if (last.verdict?.valid || history.length >= 3) return [] // done, or out of shots
  // The core move: read the last worker's real output, write the next prompt FROM it.
  return [{ prompt: `Rewrite "${last.output?.note}" to mention the rollback path.` }]
},
```

It prints:

```text
shot 0: reject — "Shipped one-click restore."
shot 1: PASS — "Shipped one-click restore with an instant rollback path."
decision: pick-winner — winner: shot 1
```

Two rules decide when the loop stops.
`plan` returns `[]` when it has no more work.
`decide` returns a value: the four keywords in `TERMINAL_DECISIONS` (`stop`, `pick-winner`, `fail`, `done`) end the loop, and every other value is your own vocabulary and continues it.
Type the return as `'your-word' | TerminalDecision` to keep the two apart.

`driver.name` is a trace label.
It never selects a strategy or a decision path.

The annotated version of the same loop, with every seam explained, is [`../driver-loop`](../driver-loop).

## Why this exists

A retry that sends the same prompt again learns nothing.
This loop reads what the worker produced, scores it with your check, and writes the next prompt from the real output.
The kernel owns the parts that are easy to get wrong — one fresh worker per attempt, a hard iteration cap, and teardown of every worker at the end — so your driver stays a few lines of plain code.
