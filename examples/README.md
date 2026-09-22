# Examples

Examples import the package exactly as an application does.
Run them from the repository root with `pnpm tsx`.

## Start Here

```bash
pnpm tsx examples/quickstart/quickstart.ts
pnpm tsx examples/interaction/interaction.ts
pnpm tsx examples/driver-loop/driver-loop.ts
```

`quickstart` runs one agent turn.
`interaction` keeps two actors in separate sessions while they respond to the shared transcript.
`driver-loop` shows application code planning several bounded worker turns.

## Choose An Example

| Need | Example | Credentials |
|---|---|---|
| One agent turn | [`quickstart`](./quickstart/) | Tangle API key |
| Product chat response | [`chat-handler`](./chat-handler/) | Provider dependent |
| Persistent named actors | [`interaction`](./interaction/) | None for the scripted provider |
| Application-planned rounds | [`driver-loop`](./driver-loop/) | None for the scripted provider |
| Dynamic worker creation | [`supervise`](./supervise/) | Tangle API key |
| Local or managed supervisor workers | [`supervisor-loop`](./supervisor-loop/) | Selected provider credentials |
| Recursive budget sharing | [`recursive-supervisor`](./recursive-supervisor/) | None |
| MCP delegation | [`mcp-delegation`](./mcp-delegation/) | Provider dependent |
| Fleet workspace delegation | [`fleet-delegation`](./fleet-delegation/) | Fleet configuration |
| Compare fixed strategies | [`strategy-suite`](./strategy-suite/) | None by default |
| Improve a profile field | [`improve`](./improve/) | None by default |
| Improve repository code | [`self-improving-coder`](./self-improving-coder/) | Optional for calibration |
| Inspect the improvement stages | [`self-improving-loop`](./self-improving-loop/) | None |
| Evolve a strategy | [`strategy-evolution`](./strategy-evolution/) | Tangle API key |
| Generate evaluated training data | [`agentic-data-creation`](./agentic-data-creation/) | None by default |
| Record and supply approved context | [`intelligence-drop-in`](./intelligence-drop-in/) | Intelligence configuration |
| Export sanitized telemetry | [`sanitized-telemetry-streaming`](./sanitized-telemetry-streaming/) | None |
| Run a coding comparison | [`coding-benchmark`](./coding-benchmark/) | None by default |
| Run a UI audit | [`ui-audit`](./ui-audit/) | Browser and provider dependent |

Each example directory documents its own environment variables and expected output.

## Development

Examples resolve the local Runtime source during repository development.
Typecheck all examples with:

```bash
pnpm run typecheck:examples
```

Use deterministic in-process or scripted providers for tests.
Use a real provider run before claiming remote sessions, workspaces, or usage reporting work.
