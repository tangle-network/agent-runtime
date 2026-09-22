# Agent Runtime Docs

Start here:

1. [`README.md`](../README.md) for installation and a working example.
2. [`concepts.md`](./concepts.md) for the execution model.
3. [`canonical-api.md`](./canonical-api.md) to choose an entry point.
4. [`architecture.md`](./architecture.md) for package and state ownership.
5. [`examples`](../examples/) for runnable programs.
6. [`api`](./api/) for generated signatures and exports.

## Focused Guides

| Topic | Document |
|---|---|
| Persistent multi-agent runs | [`durability-adapters.md`](./durability-adapters.md) |
| Dynamic worker coordination | [`agent-managed-compute/README.md`](./agent-managed-compute/README.md) |
| Intelligence integration | [`intelligence-sdk.md`](./intelligence-sdk.md) |
| Contribution rules | [`BUILDING.md`](./BUILDING.md) |
| Package maintenance | [`MAINTAINING.md`](./MAINTAINING.md) |

Generated files under `api` must not be edited by hand.

Run `pnpm docs:check` after changing public exports or these guides.
