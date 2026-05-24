# mcp-delegation

How a product mounts the `agent-runtime-mcp` server into its `AgentProfile`,
plus a tiny stdio JSON-RPC client that proves the server exposes all five
delegation tools.

## Run

```bash
pnpm build                                          # build the local bin
pnpm tsx examples/mcp-delegation/mcp-delegation.ts
```

The first block prints the `mcp['agent-runtime-delegation']` entry a
product passes to `sandboxClient.create({ backend: { profile } })`. The
second block spawns the locally-built `dist/mcp/bin.js`, calls
`tools/list` over stdio JSON-RPC, and asserts the five canonical tools
are present.

## What it shows

- The literal `AgentProfileMcpServer` shape consumers paste into their own
  product's profile composer.
- The bin's expected env: `TANGLE_API_KEY` for live delegations,
  `AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1` for the diagnostic mode the smoke leg
  uses when no key is set.
- The five canonical tools every consumer expects:
  - `delegate_code` — async coder dispatch
  - `delegate_research` — async researcher dispatch
  - `delegate_feedback` — append-only rating store
  - `delegation_status` — poll for `pending` / `running` / `completed`
  - `delegation_history` — read past delegations newest-first

## Production wiring

```ts
import type { AgentProfile } from '@tangle-network/sandbox'

const profile: AgentProfile = {
  // ...your product's profile...
  mcp: {
    'agent-runtime-delegation': {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@tangle-network/agent-runtime', 'mcp'],
      env: {
        TANGLE_API_KEY: process.env.TANGLE_API_KEY!,
        SANDBOX_BASE_URL: 'https://sandbox.tangle.tools',
      },
      enabled: true,
    },
  },
}
```

Pass `profile` to `sandboxClient.create({ backend: { profile } })`. The
sandbox-side agent harness now sees the five delegation tools mid-turn,
and can fan work out to coders/researchers without blocking the chat.

See [`fleet-delegation`](../fleet-delegation/) for the multi-machine
variant where delegations dispatch into a shared workspace instead of
sibling sandboxes.
