# improve

`improve()` — the one pluggable RSI (recursive self-improvement) verb, offline.

`improve(profile, findings, opts)` optimizes ONE surface of an agent's profile and ships the winner
only if it clears the held-out gate. It is a facade over agent-eval's `selfImprove`: you name a
`surface` (`'prompt'`, `'skills'`, `'tools'`, ...) and it picks the matching default mutator, extracts
the baseline from the profile, runs the loop, and — on a ship verdict — writes the promoted surface
back into the profile field.

`findings` is a REQUIRED positional argument (an `AnalystFinding[]`) — the trace analysts' read of
what went wrong, which the loop reflects on. `makeFinding` stamps the schema-version / id / timestamp
the full finding shape needs.

## Run

```bash
pnpm tsx examples/improve/improve.ts
```

Runs **offline, no credentials**: a scripted `SurfaceProposer` proposes a fixed winning candidate, a
deterministic judge scores it, and the "agent" returns the surface verbatim while reporting token
usage (so agent-eval's backend-integrity guard sees a real backend). Prints `{ shipped, lift }` and
the prompt after improvement. The same path is covered by `src/improvement/improve.test.ts` (part of
`pnpm test`).

## Going live

Swap the scripted `generator` out (omit it) and pass `llm: { apiKey, baseUrl, model }` — the facade
then builds the real reflective proposer (`gepaProposer` for `surface: 'prompt'`). Drop `gate: 'none'` /
keep the default `'holdout'` so the held-out gate decides what ships. `opts.allowedModels` restricts
the run to a chosen model subset (fail-loud before the generator is built).
