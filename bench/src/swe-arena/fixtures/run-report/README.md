# run-report evidence

Reports over completed runs, committed as the measured record behind the supervisor-behavior
claims. Both source run directories were read READ-ONLY (`--report-dir` wrote the reports
here, never into the run).

The reader is `@tangle-network/agent-eval/supervisor-run` — a supervision tree is a rollout
trace with one more dimension, so it lives in the trace-analysis layer next to single-rollout
analysis. `src/swe-arena/run-report.mts` is only the CLI over it, and these files were
produced before that move; they reproduce byte-identically through the library, except that
the newer `economics.brainTruncations` metric did not exist when they were captured.

| File | Source run | Command |
|---|---|---|
| `gen3-rollup.{json,md}` | gen-3 arena, 51 cells (`…/scratchpad/hh/gen3`) | `tsx src/swe-arena/run-report.mts --round <gen3> --report-dir <out>` |
| `factory-agent-eval-309-FSUP0.{json,md}` | factory gen-0 live, cell `factory.agent-eval.309` rep 0 (`/tmp/factory-gen0-live`) | `tsx src/swe-arena/run-report.mts <cellDir> --patch <p> --ledger <ledger.jsonl> --report-dir <out>` |

Headline facts these files carry:

- **gen-3: 0 steers across all 51 cells.** 42 cells measured a real `0`; 9 cells report
  `unavailable` (no `workers/` directory — the supervisor never started a worker there).
  161 workers spawned, 35 accepted, mean 3.1 waves per cell, mean worker utilization 0.47,
  mean idle share 52.6%, $3.26 brain spend, 17/51 judged resolved.
- **factory.agent-eval.309 (FSUP0, rep 0): 0 steers, 4 waves `[2,1,1,1]`, 5 workers,
  utilization 0.663, idle 15.6min of a 32.2min run (48.3%).** 3 accepted / 1 rejected /
  1 empty-pass; every respawn was preceded by settled evidence (3/3); delegation depth 1;
  judge 13/30 (score 0.4333, unresolved).

Read together: the supervisor is a dispatcher with a retry loop — spawn → wait → read
settled evidence → respawn — not a lead steering contributors mid-task. Half the wall clock
has no worker running at all.
