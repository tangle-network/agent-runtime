type: patch
---
A stdio MCP server that exits during the handshake is reported with its complete (redacted) stderr: a stdin write failure now waits up to 250 ms for the server's exit instead of failing first with no stderr. A server that stays alive with its stdin closed still fails promptly.
