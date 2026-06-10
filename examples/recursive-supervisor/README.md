# recursive-supervisor

The recursive execution atom from `@tangle-network/agent-runtime/loops`: one
self-similar `Agent` runs inside a budget-conserving reactive `Scope`,
orchestrated by `createSupervisor`. A leaf is an `Agent` that never calls
`scope.spawn`; a driver is an `Agent` whose `act()` spawns children and
reacts to their settlements via `scope.next()`.

Two passes over the same topology:

1. **Raw Supervisor** — a driver spawns two scripted children on a conserved
   pool. `spawn` atomically reserves each child's whole budget ceiling and
   **fails closed** when the pool cannot cover it (the example shows a third
   spawn rejected with `budget-exhausted`) — equal compute across arms holds
   by construction. The driver drains settlements and selects the best valid
   via `defaultSelectWinner`, the same single-sourced argmax `runLoop` uses.
2. **The `fanout` combinator** — the identical spawn/drain/select topology as
   one content-free combinator over a `definePersona` + `runPersonified`
   pair. The shape carries the topology; the persona carries the domain.

## Run

```bash
pnpm tsx examples/recursive-supervisor/recursive-supervisor.ts
```

Fully offline: children resolve through the open `Executor` port and this
example brings its own scripted executors (fixed usage events + a scripted
artifact). No network, no sandbox, no key.

## Wire to production

- Real leaves: `createExecutor({ backend })` — `router` (one inference
  call), `router-tools` (the off-box tool-using loop), `sandbox` (a box
  running `runLoop` as a leaf), `cli` — or any object implementing
  `Executor` (BYO is first-class via `executorSpec.executor`).
- Richer shapes: `loopUntil`, `panel`, `verify`, `pipeline`, `widen` (same
  subpath) compose the same way `fanout` does.
- Durability: swap `InMemorySpawnJournal` / `InMemoryResultBlobStore` for the
  file-backed implementations to get replay/resume.
- One level up — strategies over a whole benchmark instead of one run:
  [`examples/strategy-suite/`](../strategy-suite/).
