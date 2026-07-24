# Watch an agent read its own run trace and propose a safe fix

An agent finishes a run, a log of that run gets turned into concrete complaints ("the agent
under-specifies its answer format"), and those complaints drive a prompt candidate that must beat
the old prompt on held-back test cases.
This example runs that whole chain end to end on your laptop with **no API key and no network**.
A deterministic method replaces the optimizer call so you can inspect the flow before wiring a live method.

## Why it matters

Most "self-improving agent" demos hand-write the feedback, which is the interesting part. This one
proves the missing link: feedback that is **derived from an actual recorded run** and carries a
pointer back to the exact trace it came from.
The selected rewrite is compared against the current prompt on untouched final-test scenarios.

## How it works

Three plain steps, all in `intelligence-recommend.ts`:

1. **Observe**: a run emits a stream of events (loop started, loop ended, cost, iteration count).
   `recordTrace(events)` bundles that stream into one trace with an id. Exporting the trace to a
   collector is best-effort, so with no collector configured it does nothing and the demo stays
   offline.
2. **Analyze**: turn the trace into `findings`, short claims about what went wrong, each tagged with
   a severity and an `evidence_refs` pointer to the trace it came from. In production a "trace
   analyst" agent writes these by reading the run; here two are hand-written so the demo needs no
   model.
3. **Improve**: `improve(profile, { method, findings, ... })` gives those findings to a complete method,
   then checks its selected prompt on final-test scenarios.
   It does not change the live profile.

## See it work

```bash
pnpm tsx examples/intelligence-recommend/intelligence-recommend.ts
```

Runs fully offline. You'll see roughly:

```
trace recorded: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
findings derived: 2
candidate decision: ship
candidate prompt: <the rewritten system prompt>
live prompt unchanged: BASELINE
```

## Files

| File | What's in it |
|---|---|
| `intelligence-recommend.ts` | The three steps: record a trace, derive findings from it, feed them to the gated rewrite |
| `README.md` | This file |

## Going live

For a live run, configure `createIntelligenceClient` so traces export, replace the two deterministic findings with trace-analyst output, and replace `scriptedWinner` with `officialGepa(...)`, `officialSkillOpt(...)`, or another complete method.
