# product-eval

User-sim product evals — `runPersonaConversation` (the persona loop) + the
`runPersonaDispatch` → matrix path.

A product eval runs the **agent under test** against a **persona** (a simulated
user) over a multi-round conversation, then scores the transcript.
`runPersonaConversation` is the loop runner: you author a worker `AgentProfile`
and a persona, and supply two seams — `backendFor` (turn a profile into a
runnable backend) and `systemPromptOf` (render its system prompt).

Three cells, smallest to largest:

1. **scripted-persona quickstart** — a fixed user script, deterministic.
2. **profile-driven (LLM user-sim) adversarial run** — the persona improvises. `maxTurns` is a
   CEILING (the hard backstop, not the target — `maxTurns: 0` means ZERO turns, NOT run-until-done);
   `haltOn` is the "until satisfied" knob that ends the run the moment the goal is met.
3. **scored matrix** — `runPersonaDispatch` turns the persona loop into a `runProfileMatrix` cell,
   run across profiles × scenarios with per-cell metering.

## Run

```bash
TANGLE_API_KEY=<router key> pnpm tsx examples/product-eval/product-eval.ts
```

Optional env: `WORKER_MODEL` (the agent under test, default `gpt-4o-mini`), `ROUTER_BASE`.

## Offline

Both `runPersonaConversation` and `runPersonaDispatch` take a `backendFor` seam — pass a fake
backend and the whole loop runs with no credentials and no network. See
`src/conversation/run-persona.test.ts` for the `$0` offline pattern (it is part of `pnpm test`).
