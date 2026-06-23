# mcp-delegation

How a product mounts the `agent-runtime-mcp` server into its `AgentProfile`,
plus a tiny stdio JSON-RPC client that proves the server exposes the
delegation tools.

## Run

```bash
pnpm build                                          # build the local bin
pnpm tsx examples/mcp-delegation/mcp-delegation.ts
```

The first block prints the `mcp['agent-runtime-delegation']` entry a
product passes to `sandboxClient.create({ backend: { profile } })`. The
second block spawns the locally-built `dist/mcp/bin.js`, calls
`tools/list` over stdio JSON-RPC, and asserts the always-on tools are
present.

## What it shows

- The literal `AgentProfileMcpServer` shape consumers paste into their own
  product's profile composer.
- The bin's expected env: `TANGLE_API_KEY` for live delegations,
  `MCP_ENABLE_DELEGATE=1` to opt the generic `delegate` verb in, and
  `AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1` for the diagnostic mode the smoke leg
  uses when no key is set.
- The delegation tools:
  - `delegate` — the ONE generic verb: a supervisor that authors + drives its
    own worker and returns the delivered output with its real spend. Replaces
    the old hardcoded `delegate_code` / `delegate_research`. Registers ONLY when
    `MCP_ENABLE_DELEGATE=1` AND a real sandbox key resolves.
  - `delegate_feedback` — append-only rating store (always on)
  - `delegation_status` — poll for `pending` / `running` / `completed` (always on)
  - `delegation_history` — read past delegations newest-first (always on)
  - `delegate_ui_audit` — served only when a UI-audit runner is wired in

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
        MCP_ENABLE_DELEGATE: '1', // opt the generic `delegate` verb in (off by default)
      },
      enabled: true,
    },
  },
}
```

Pass `profile` to `sandboxClient.create({ backend: { profile } })`. The
sandbox-side agent harness now sees the delegation tools mid-turn, and can
fan work out via the generic `delegate` verb without blocking the chat.
Omit `MCP_ENABLE_DELEGATE` and only the always-on trio
(`delegate_feedback` / `delegation_status` / `delegation_history`) is exposed.

See [`fleet-delegation`](../fleet-delegation/) for the multi-machine
variant where delegations dispatch into a shared workspace instead of
sibling sandboxes.
