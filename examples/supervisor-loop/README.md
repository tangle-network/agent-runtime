# Supervisor loop

This example runs one supervisor that creates worker agents, waits for their results, and accepts only output that passes a code check.

Workers can use either provider:

- `cli-bridge` runs installed coding CLIs.
- `tangle` runs managed Tangle environments.

Both use the same `AgentEnvironmentProvider` contract.

## Run

Build the package first because the examples import `dist`.

```bash
pnpm build

# Local coding CLI workers
WORKER_PROVIDER=cli-bridge \
WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 \
pnpm tsx examples/supervisor-loop/run.ts

# Managed Tangle workers
WORKER_PROVIDER=tangle \
TANGLE_API_KEY=sk-... \
SANDBOX_BASE_URL=https://... \
pnpm tsx examples/supervisor-loop/run.ts
```

Start `cli-bridge` before using the local provider:

```bash
cd ~/code/cli-bridge
pnpm install
pnpm install:harness -- opencode
pnpm start
```

Use a model as the supervisor by setting `DRIVER_MODEL` and `TANGLE_API_KEY`.
Without them, `run.ts` uses fixed local turns so the control flow can be tested without inference.

## MCP supervisor

`run-supervisor-mcp.ts` makes a coding agent the supervisor.
Runtime serves `spawn_agent`, `await_event`, and `stop` over MCP, then mounts that server through `AgentProfile.mcp`.
The supervisor and every worker still run through provider objects.

```bash
WORKER_PROVIDER=cli-bridge \
WORKER_MODEL=opencode/anthropic/claude-sonnet-4-5 \
pnpm tsx examples/supervisor-loop/run-supervisor-mcp.ts
```

## Files

| File | Purpose |
|---|---|
| `run.ts` | Run `supervise()` with a model or fixed local turns |
| `run-supervisor-mcp.ts` | Let a coding agent call the coordination tools over MCP |
| `shared.ts` | Select the worker provider and define the output check |

Run the local control-flow tests with:

```bash
pnpm exec vitest run tests/loops/coordination-driver.test.ts tests/supervisor-loop-example.test.ts
```
