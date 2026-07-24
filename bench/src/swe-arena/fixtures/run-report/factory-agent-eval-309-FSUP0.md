# Run report — factory.agent-eval.309 [FSUP0]

```
RUN-REPORT factory.agent-eval.309 [FSUP0]
  steers=0 (spawn→wait→respawn only; no mid-task steering)
  waves=4 sizes=[2,1,1,1] workers=5 settled=5 cancelled=0
  concurrency max=2 utilization=0.663 idle=15.6min (48.3%) wall=32.2min
  respawns=3 evidence→respawn=3 blind-respawn=0 depth=1
  accepted=3 rejected=1 empty-pass=1
  brain=$0.179577 total=$0.179577 judge.resolved=false score=0.4333 verify=unavailable — result.json absent or has no verify_pass
  gaps(1): verifyPass: result.json absent or has no verify_pass
```

- Cell dir: `/tmp/factory-gen0-live/rep-0/runs/factory.agent-eval.309/FSUP0`
- Supervisor: `sup-1-8f75ee`
- Generated: 2026-07-24T00:32:17.691Z

## Orchestration

| Metric | Value |
|---|---|
| Workers spawned | 5 |
| Workers settled | 5 |
| Workers cancelled | 0 |
| **Steers (mid-task messages to live workers)** | **0** |
| Steers delivered | 0 |
| Outer-driver `supervisor_steer` calls | 0 |
| Spawn waves | 4 |
| Wave sizes | [2, 1, 1, 1] |
| Max concurrency | 2 |
| Respawns (spawns after first settle) | 3 |
| Repeated labels | none |
| Delegation depth | 1 |
| Time to first spawn | 13.9min |
| Supervisor wall | 32.2min |
| Idle (zero live workers) | 15.6min (48.3%) |
| Worker utilization (Σ worker wall ÷ supervisor wall) | 0.663 |

### Steers per worker

| Worker | Queued | Delivered |
|---|---:|---:|
| `w-0` | 0 | 0 |
| `w-1` | 0 | 0 |
| `w-2` | 0 | 0 |
| `w-3` | 0 | 0 |
| `w-4` | 0 | 0 |

## Decision quality

| Metric | Value |
|---|---|
| Settled by status | done=5 |
| Settled verdicts | none |
| Accepted (verify green + patch bytes) | 3 |
| Rejected (verify red) | 1 |
| Empty pass (green, no patch) | 1 |
| Evidence → respawn sequences | 3 |
| Respawn with no settled evidence in front | 0 |
| Review actions (steers + worker questions) | 0 |
| Worker evidence returned | 12153 bytes |

## Economics

| Role | Tokens in | Tokens out | USD | Source |
|---|---:|---:|---:|---|
| brain | 228169 | 19398 | 0.179577 | journal metered events (n=17) |
| workers | 286763 | 69794 | 0 | journal settled spend + opencode sessions (n=5) |

- Total USD: 0.179577 (source: state.json result.spentUsd — brain-priced only; worker CLI inference is unpriced (see worker token counts))
- Cost per accepted patch: 0.059859
- Worker wall (n=5): min 70.4s / p50 3.9min / p90 9.3min / max 9.3min / Σ 21.2min

| Worker | Wall | Patch bytes | Verify passed |
|---|---:|---:|---|
| `w-0` | 9.3min | 21183 | false |
| `w-1` | 4.7min | 14573 | true |
| `w-2` | 70.4s | 0 | true |
| `w-3` | 3.9min | 21325 | true |
| `w-4` | 2.2min | 1016 | true |

## Outcome

| Metric | Value |
|---|---|
| Supervisor status | completed |
| Supervisor verdict | delivered |
| Delivered | true |
| Judge resolved | false |
| Judge score | 0.4333 |
| Judge passed / total | 13 / 30 |
| Judge source | /tmp/factory-gen0-live/ledger.jsonl (ledger row) |
| Verify gate | pass=unavailable — result.json absent or has no verify_pass rc=unavailable — result.json absent or has no verify_rc |
| Patch | 5 file(s), +939/-0, test files touched: src/capability-headroom.test.ts, src/paired-arms.test.ts |

## Gaps

- verifyPass: result.json absent or has no verify_pass

> Harness-session view of the same cell (model calls, stuck loops, tool errors): `npx --yes @tangle-network/traces@latest analyze --harness opencode --cwd <worker-clone-cwd>`
