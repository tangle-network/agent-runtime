# agent-runtime Agent Bootloader

Read `CLAUDE.md` first. This repo keeps provider-specific entry files short:

- `CLAUDE.md`: repo orientation, code map, layering, commands, and local deltas.
- `docs/BUILDING.md`: stable building discipline.
- `docs/ANTI_PATTERNS.md`: named failure modes and stop signs.
- `.evolve/current.json` and `memory/`: live state and evidence ledger.

Do not duplicate long-lived process rules here. Add durable rules to the docs
above and keep this file as the provider-neutral pointer.
