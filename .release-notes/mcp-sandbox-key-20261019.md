type: minor
---
`agent-runtime-mcp` builds its Sandbox client from `TANGLE_SANDBOX_API_KEY` when it is set, and from `TANGLE_API_KEY` otherwise. A platform key serves one product, so a caller holding a Router key and a separate Sandbox key now passes the Sandbox key under its own name, while `MCP_SUPERVISOR_ROUTER_KEY` stays the supervisor's router key. Neither key is forwarded into a worker box.
