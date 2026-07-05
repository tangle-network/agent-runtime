# Give your agent a "hand this off" button

This shows how to bolt a delegation toolkit onto any agent so that, mid-conversation, it can fan a
piece of work out to a fresh worker agent instead of blocking the chat — then check on it and read the
result later. The toolkit ships as an MCP server (a standard side-process an agent talks to over
stdio), and this example both prints the exact config you paste into your agent and then boots the
server to prove the tools are really there. It runs offline in a diagnostic mode with no API key.

## Why it matters

Long tasks kill chat UX: the user asks for something slow, and the agent goes silent for two minutes.
Delegation lets the agent say "I'll start that and keep talking," dispatch it to a worker, and surface
the result when it's done. You don't build any of that — you mount one MCP entry into your agent's
profile and the delegation verbs show up as tools the agent can call on its own.

## How it works

The example has two blocks:

1. **Profile** — builds the literal `mcp` entry you drop into your agent's `AgentProfile`. It launches
   the toolkit via `npx -y @tangle-network/agent-runtime mcp` and passes it env vars. That's the whole
   integration — copy the printed block.
2. **Smoke test** — spawns the locally-built server (`dist/mcp/bin.js`), asks it to list its tools over
   stdio, and asserts the always-on ones are present.

The tools it exposes:

- `delegate` — the one generic verb: an agent that authors and drives its own worker, then returns the
  worker's output plus what it really spent. Only registers when `MCP_ENABLE_DELEGATE=1` **and** a real
  sandbox key resolves.
- `delegate_feedback` — rate a past delegation (always on).
- `delegation_status` — poll a job: pending / running / completed (always on).
- `delegation_history` — read past delegations, newest first (always on).

## See it work — no API key needed

```bash
pnpm build                                          # produces dist/mcp/bin.js
pnpm tsx examples/mcp-delegation/mcp-delegation.ts
```

With no `TANGLE_API_KEY` set, the example runs the server in a diagnostic mode
(`AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1`, set for you) so it still lists tools. You'll see:

```
— PROFILE ————————————————————————————————
profile.name: demo-product-agent
profile.mcp[agent-runtime-delegation]:
{ ...the config block to copy... }

— SMOKE ———————————————————————————————————
server: agent-runtime-mcp@<version>
tools: [delegate_feedback, delegation_history, delegation_status]
OK — the always-on queue-bound delegation tools are exposed.
```

The generic `delegate` verb is absent here on purpose — it needs a live sandbox key.

## Files

| File | What's in it |
|---|---|
| `mcp-delegation.ts` | Builds the profile MCP entry, then spawns and smoke-tests the server |
| `README.md` | This file |

## Wiring it into your own product

Set `MCP_ENABLE_DELEGATE=1` and a real `TANGLE_API_KEY` in the mounted entry's `env`, then pass your
profile to `sandboxClient.create({ backend: { profile } })`. The agent then sees the delegation tools
mid-turn and can fan work out without blocking the chat. Omit `MCP_ENABLE_DELEGATE` and only the
always-on trio is exposed. For the multi-machine variant where delegations dispatch into a shared
workspace, see `../fleet-delegation/`.
