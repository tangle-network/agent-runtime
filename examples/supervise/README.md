# Let one agent run other agents

## When to use it

Use this when a model must decide the plan, not your code.
One supervisor spawns workers, steers them, and stops when a check passes on a worker's real output.
Budget, journaling, and depth limits are defaulted.

Use a sibling instead when your code owns the plan.
[`../quickstart`](../quickstart) is the loop you write yourself with `plan` and `decide`.
[`../graphs`](../graphs) is a fixed topology authored as data.
[`../supervisor-loop`](../supervisor-loop) is this same call with a real worker backend, such as a sandbox or a coding CLI.
[`../delegate`](../delegate) is the zero-configuration entry: one intent string in, one result out.

## How to use it

```bash
TANGLE_API_KEY=sk-tan-... pnpm build && pnpm tsx examples/supervise/supervise.ts
```

A key is required, because the supervisor's brain and the worker both call the router.
`MODEL` and `TANGLE_ROUTER_URL` are optional.

On success it prints the delivered output:

```text
[OK] delivered: {"content":"READY"}
```

When no worker delivers, it prints the reason and the spend instead:

```text
[--] no winner (budget-exhausted) — 1 child(ren) down, spent 4210 tokens / $0.0031
```

Three settings are worth knowing.

- `profile.harness` picks what drives the supervisor's brain. This example uses `cli-base`, the router-backed brain with no coding agent. Set `opencode`, `claude-code`, or `codex` to run a coding CLI in a sandbox.
- `backend` is where the workers run. This example uses `router-tools`. Change it to `sandbox` plus a harness to run each worker as a coding agent in a real box.
- `deliverable` is the completion check. It is optional, and it is what makes "done" mean verified.

## Why this exists

Multi-agent orchestration usually becomes glue code: spawn, track, collect, and guess when the work is done.
This is one call with defaults, so you write a goal and a profile instead of a framework.
"Done" is your check against a worker's output, so a worker cannot claim success, and a failure reports the real reason and the spend.

## Caller-named resource limits

Run the offline [resource accounting example](./named-resources.ts):

```bash
pnpm tsx --tsconfig tsconfig.examples.json examples/supervise/named-resources.ts
```

`Budget.resources` pairs each caller-owned name with a unit and limit.
Executors report matching `Spend.resources` totals or incremental resource usage events.
Every child must declare all dimensions enforced by its parent.
Reservations include all standard and named channels atomically.
Known unused allocations return to the pool.
Missing or unknown enforced measurements block further admission and remain unknown after restart.
The runtime trusts executor measurements; it does not measure accelerator use or network traffic itself.

A model-driven root also needs a measured receipt for every enforced dimension.
A custom child executor alone cannot supply the root's measurements.
The existing `router.complete` transport can return them as `usage.resources`:

```ts
return {
  ...completion,
  usage: {
    ...completion.usage,
    resources: {
      compute: { unit: 'millisecond', amount: measuredComputeMs, known: true },
      transfer: { unit: 'byte', amount: measuredTransferBytes, known: true },
    },
  },
}
```

The transport must forward the Runtime-authored request without changing its model, profile, tools, or settings.
It must derive those amounts from trustworthy measurements for that completion.
An explicit measured zero is valid; an omitted dimension remains unknown and blocks admission.
Buffered and streamed Router responses use the same receipt validation.
Inline Router executors sum turn receipts and preserve unknown measurements across turns.
Custom tool-loop brains can return the same map as `resources` on their existing response.
The public `supervise` regression is `tests/kernel/named-resource-driver.test.ts`.
