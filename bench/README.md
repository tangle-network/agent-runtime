# agent-runtime-bench

Private experiment workspace nested in agent-runtime; decoupled from its build/lint/release (the package builds `src/`, lints `src tests examples` — `bench/` is none of those).

**Read [`bench/HARNESS.md`](./HARNESS.md) FIRST.** It is the one maintained map: the commands, the `rollout → corpus → selector → CI → gate` data flow, the canonical-suite table, the wired/needs-creds/scaffolded matrix, and the gate one-liners — kept verified against source.

## SWE-bench judge setup (the one block not in HARNESS.md)

```bash
python3 -m venv .venv && .venv/bin/pip install swebench   # SWE-bench harness
pnpm install                                              # tsx + link parent
# Docker daemon must be running (judges build/run per-instance images)
```

The judge needs only Docker; workers need a model key (Tangle router `TANGLE_API_KEY`, or a direct provider).
