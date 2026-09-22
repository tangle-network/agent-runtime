# Give your agent a "hand this off" button

This shows how to add delegation tools to an agent so it can send work to a fresh worker, continue the conversation, and read the result later.
The tools run as an MCP server, a standard side process that communicates over stdio.
The example prints the exact profile config for delegate mode, then starts the server in queue-only mode with no API key and checks its tools.

## Why it matters

Long tasks make an agent stop responding while work runs.
Delegation lets it dispatch that work, keep talking, and return the result when it is ready.
Mount one MCP entry in the agent profile and the delegation operations become tools the agent can call.

## How it works

The example has two blocks:

1. **Profile** builds the `mcp` entry for an `AgentProfile`.
   It launches `npx -y @tangle-network/agent-runtime mcp` with delegate mode and a real `TANGLE_API_KEY`.
2. **Smoke test** starts the locally built server (`dist/mcp/bin.js`) in queue-only mode, lists its tools over stdio, and checks the always-on tools.

The tools it exposes:

- `delegate`: author and drive a worker, then return its output and usage.
  It is registered only when `MCP_ENABLE_DELEGATE=1` and `TANGLE_API_KEY` is set.
- `delegate_feedback`: rate a past delegation.
- `delegation_status`: poll a pending, running, or completed job.
- `delegation_history`: read past delegations, newest first.

## Run queue-only mode

```bash
pnpm build                                          # produces dist/mcp/bin.js
pnpm tsx examples/mcp-delegation/mcp-delegation.ts
```

The smoke process leaves `MCP_ENABLE_DELEGATE` unset and removes `TANGLE_API_KEY`.
This selects queue-only mode, which does not need an API key.
You will see:

```
PROFILE
profile.name: demo-product-agent
profile.mcp[agent-runtime-delegation]:
{ ...the config block to copy... }

SMOKE
server: agent-runtime-mcp@<version>
tools: [delegate_feedback, delegation_history, delegation_status]
OK: the queue-only delegation tools are exposed.
```

The `delegate` tool is absent because queue-only mode does not enable it.
If `MCP_ENABLE_DELEGATE=1` is set without `TANGLE_API_KEY`, the server exits immediately.

## Files

| File | What's in it |
|---|---|
| `mcp-delegation.ts` | Builds the profile MCP entry, then starts and checks the server |
| `README.md` | This file |

## Wiring it into your own product

Set `MCP_ENABLE_DELEGATE=1` and a real `TANGLE_API_KEY` in the mounted entry's `env`.
Then pass your profile to `provider.create({ profile, backend: 'opencode' })`, where `provider` comes from `createTangleProvider({ client: new Sandbox({ apiKey }) })`.
The agent then sees the delegation tools mid-turn and can fan work out without blocking the chat.
Omit `MCP_ENABLE_DELEGATE` and only the always-on trio is exposed.
For the multi-machine variant where delegations dispatch into a shared workspace, see `../fleet-delegation/`.
