# Where does delegated work run? Fresh box, or a shared machine pool

When an AI agent splits a job and hands the pieces to other workers, those workers have to run
*somewhere*. This runtime offers two placement strategies, and a single environment variable switches
between them — the delegation code is identical either way:

- **Sibling** (default) — every delegated task gets its own brand-new throwaway sandbox. Fully isolated
  and clean, but the workers share nothing: each result comes back over the wire, not through files.
- **Fleet** (set `TANGLE_FLEET_ID`) — delegated tasks are spread round-robin across a pool of
  already-running machines that share ONE workspace. Every worker sees the same filesystem, so edits
  from parallel workers land in place, on the same checkout.

## Why it matters

The choice is real and consequential. If three workers are each writing a different file into the same
repo, you want **fleet**: they all edit one shared checkout and the diffs merge in place. If you want
each task hermetically isolated with zero chance of one worker stepping on another, you want
**sibling**. Most runtimes bake this decision in; here it's one env var over the same code.

## See it work — no API key needed

The machines are in-process stubs, so this runs offline and just prints how each mode tags its
dispatches — the placement decision the runtime actually makes:

```bash
pnpm tsx examples/fleet-delegation/fleet-delegation.ts
```

```
— SIBLING MODE ——
dispatch[0] → placement=sibling sandboxId=sandbox-sibling-sandbox-xyz

— FLEET MODE ——
dispatch[0] → placement=fleet fleetId=test-fleet machineId=worker-a sandboxId=…
dispatch[1] → placement=fleet fleetId=test-fleet machineId=worker-b sandboxId=…
dispatch[2] → placement=fleet fleetId=test-fleet machineId=worker-c sandboxId=…
```

In fleet mode the three dispatches round-robin across `worker-a/b/c`. The `coordinator-0` machine —
where the delegating agent itself runs — is excluded so it doesn't compete with its own workers.

## The topology

```
Sibling                          Fleet
──────                           ─────
parent agent                     coordinator-0  (excluded)
   │                                │
   │ delegate                       │ delegate
   ▼                                ▼
fresh box   (isolated)           worker-a  ←─┐
fresh box   (isolated)           worker-b  ←─┤  round-robin
fresh box   (isolated)           worker-c  ←─┘
                                   │
                                   └─ all share ONE workspace;
                                      diffs land in place
```

## Wiring it for real

The dispatch mode is chosen entirely by environment when the delegation server starts:

```bash
TANGLE_API_KEY=sk_sb_*                          # your sandbox key (both modes)
SANDBOX_BASE_URL=https://sandbox.tangle.tools

# Sibling mode: just omit TANGLE_FLEET_ID.

# Fleet mode:
TANGLE_FLEET_ID=<the fleet your parent runs in>
TANGLE_FLEET_EXCLUDE_MACHINES=coordinator-0     # comma-separated machines to skip
```

With `TANGLE_FLEET_ID` set, the runtime routes work across the fleet's shared-workspace machines;
without it, each delegation spins up its own isolated sandbox. Every dispatch also emits a
`loop.iteration.dispatch` event carrying its placement tag (`sibling` vs `fleet`, plus the machine and
sandbox ids), so log pipelines can trace a worker's output back to exactly where it ran.

## Files

| file | what it is |
|---|---|
| `fleet-delegation.ts` | the two-mode demo (offline stubs) that prints each mode's placement tags |

## Honest scope

This demo uses in-process stubs so you can see the placement logic for $0. The production factories
that do it for real are `createSiblingSandboxExecutor` and `createFleetWorkspaceExecutor` in
`src/mcp/executor.ts`, wired from env in `src/mcp/bin.ts`.
