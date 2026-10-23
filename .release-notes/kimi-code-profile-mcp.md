type: minor
---
Local kimi-code harness runs now materialize a profile's MCP servers: agent-profile-materialize >= 0.27.2 lowers kimi MCP to the `<cwd>/.kimi-code/mcp.json` auto-load surface, so admission accepts MCP-carrying profiles for kimi-code instead of refusing them. The materializer dependency floor rises to 0.27.2 to guarantee the fixed lowering.
