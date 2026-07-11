# agent-runtime-bench

Published as `@tangle-network/agent-bench`, with independent CI and release checks for its TypeScript and Python surfaces.

**Read [`bench/HARNESS.md`](./HARNESS.md) FIRST.** It is the one maintained map: the commands, the `rollout → corpus → selector → CI → gate` data flow, the canonical-suite table, the wired/needs-creds/scaffolded matrix, and the gate one-liners — kept verified against source.

## SWE-bench judge setup (the one block not in HARNESS.md)

```bash
python3 -m venv .venv && .venv/bin/pip install swebench   # SWE-bench harness
pnpm install                                              # tsx + link parent
# Docker daemon must be running (judges build/run per-instance images)
```

The judge needs only Docker; workers need a model key (Tangle router `TANGLE_API_KEY`, or a direct provider).

## Pier custom candidates

The package executes a branded `PreparedAgentCandidateExecution` from `@tangle-network/agent-runtime` through one atomic API and ships `pier_agents.tangle_candidate:TangleCandidateAgent` as its thin Pier transport.
The executor recreates every input from runtime-verified file bytes and reveals model credentials only inside the claimed execution callback.
Pier owns the task container and verifier; protected model usage and traces stay in `@tangle-network/agent-eval` and are finalized by the shared runtime.
`FilePierCandidateTrialController` atomically reserves a unique Pier job, then persists the supervisor PID, process-session identity, and that job's exact Docker projects so a fresh evaluator process can stop and remove an abandoned trial.
Run `PIER_REPO=/path/to/pier pnpm verify:pier` for the zero-model failure/pass and fresh-process recovery proof, and see `HARNESS.md` for the exact invocation and failure contract.
From an installed npm package, expose the shipped Python module with `export PYTHONPATH="$(npm root)/@tangle-network/agent-bench${PYTHONPATH:+:$PYTHONPATH}"` before invoking Pier.
