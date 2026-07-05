# Run a supervisor agent that delegates the work, in one function call

Give a goal to a supervisor agent and it breaks the work off to worker agents, waits for them
to finish, and only calls itself done when a real check passes on a worker's actual output —
not when a worker *claims* success. This whole pattern is one call: `supervise(profile, task,
opts)`. Everything else (bookkeeping, worker plumbing, depth limits) is defaulted for you.

## Why it matters

Multi-agent orchestration usually means a pile of glue: spawning workers, tracking who's
running, collecting results, deciding when it's truly done. Two things here make that
tractable. First, it's a single call with sane defaults, so you write a goal and a profile,
not a framework. Second, "done" is a **check you provide** that runs against the worker's
output — so a worker can't lie its way to completion, and a failure reports the real reason
and the spend instead of a silent "no winner."

## What runs

The goal is deliberately tiny: *produce the exact line `READY`*. It's a stand-in for real
delegated work so the mechanics are visible.

1. The supervisor (its brain is a model reasoning over `spawn_agent` / `await_event` / `stop`
   tools) is told to **delegate, not solve**: spawn a worker, wait for it to settle, then stop.
2. A worker agent runs and produces its output.
3. The completion check `out => ...includes('READY')` runs against that output. Only if it
   passes is the run a win. If no worker ever delivers, the run ends with a typed reason plus
   token/dollar spend.

Three knobs are worth knowing:

- **`profile.harness`** picks what drives the supervisor's brain: `null` (this example) uses
  an in-process model tool-loop; `'opencode'` / `'claude-code'` / `'codex'` run a real coding
  CLI in a sandbox instead.
- **`backend`** is *where the workers run* — one value to swap. Here it's `router-tools`
  (off-box model agents); change it to `sandbox` + a harness to run each worker as a coding
  agent in a real box.
- **`deliverable`** is the completion check described above. Optional, but it's what makes
  "done" mean *verified* rather than *self-reported*.

## Run it

```bash
TANGLE_API_KEY=sk-tan-... pnpm tsx examples/supervise/supervise.ts
```

A key is required (the supervisor's brain and the worker both call the Tangle router).
Optional: `MODEL` (default `gemini-2.5-pro`), `TANGLE_ROUTER_URL`.

On success it prints the delivered output:

```
[OK] delivered: {"content":"READY"}
```

If no worker delivers, it prints the reason and what it cost instead:

```
[--] no winner (budget-exhausted) — 1 child(ren) down, spent 4210 tokens / $0.0031
```

## Going further

This is the smallest possible call — model brain, off-box workers, everything defaulted. When
your workers need a real backend (a sandbox box, a local coding CLI, or an MCP tool server),
go to [`../supervisor-loop/`](../supervisor-loop/): the same `supervise()` call with the
worker backend swapped in as the only change.
