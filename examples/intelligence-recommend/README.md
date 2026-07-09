# Watch an agent read its own run trace and propose a safe fix

An agent finishes a run, a log of that run gets turned into concrete complaints ("the agent
under-specifies its answer format"), and those complaints drive an automatic prompt rewrite that only
ships if it beats the old prompt on held-back test cases. This example runs that whole chain end to
end on your laptop with **no API key and no network** — a scripted stand-in plays every part that
would normally call a model, so you can see the shape of the loop before you wire real components in.

## Why it matters

Most "self-improving agent" demos hand-write the feedback, which is the interesting part. This one
proves the missing link: feedback that is **derived from an actual recorded run** and carries a
pointer back to the exact trace it came from, so every proposed change is traceable to evidence. And
the rewrite is **gated** — it is compared against the current prompt on a set of scenarios held out
from the ones used to generate it, so a change that only looks good on paper never ships.

## How it works

Three plain steps, all in `intelligence-recommend.ts`:

1. **Observe** — a run emits a stream of events (loop started, loop ended, cost, iteration count).
   `recordTrace(events)` bundles that stream into one trace with an id. Exporting the trace to a
   collector is best-effort, so with no collector configured it does nothing and the demo stays
   offline.
2. **Analyze** — turn the trace into `findings`: short claims about what went wrong, each tagged with
   a severity and an `evidence_refs` pointer to the trace it came from. In production a "trace
   analyst" agent writes these by reading the run; here two are hand-written so the demo needs no
   model.
3. **Improve** — `improve(profile, findings, ...)` reads the findings and proposes a new system
   prompt, then checks it on held-out scenarios and reports a ship/no-ship verdict. Here the proposer
   and judge are scripted and deterministic.

## See it work — no API key needed

```bash
pnpm tsx examples/intelligence-recommend/intelligence-recommend.ts
```

Runs fully offline. You'll see roughly:

```
trace recorded: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
findings derived: 2
gated candidate: shipped=true gate=pass
prompt after: <the rewritten system prompt>
```

## Files

| File | What's in it |
|---|---|
| `intelligence-recommend.ts` | The three steps: record a trace, derive findings from it, feed them to the gated rewrite |
| `README.md` | This file |

## Going live

To run this for real: give `createIntelligenceClient` a tenant `apiKey` (and, if not the prod plane, a
`baseUrl` / `TANGLE_INTELLIGENCE_URL`) so traces actually export; replace the two hand-written findings with a
real trace-analyst agent's output; and drop the scripted proposer for a model-backed one (pass an
`llm` instead of a `generator`) so the rewrite is reflected from the findings rather than pre-canned.
