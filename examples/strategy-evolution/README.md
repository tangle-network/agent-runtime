# Evolve a strategy on the search kernel

## When to use it

Use `runStrategyEvolution` when a model should write new strategies for spending an agent's attempts, and a better one should ship only when it beats the current strategy on tasks the search never saw.

Every strategy is a node on Eval's search kernel: the `root` you supply, or a module the author wrote from its parent's source and the train results.
The default policy is `beam({ width: 2 })` and the default allocator `asha()`, so each new strategy is screened on 6 selection tasks and earns more only by ranking well.
The claim runs the root and at most 3 finalists together on the sealed test tasks, once, with a power check and a Bonferroni decision.
The ledger is the only checkpoint, and the returned report is its projection.

## Run it

```bash
pnpm build
pnpm tsx examples/strategy-evolution/strategy-evolution.ts [outDir]
```

The run is offline.
The worker is the counter's deterministic transport from [`../strategy-suite/counter-env.ts`](../strategy-suite/counter-env.ts), and each shot runs at most 3 tool turns.
A strategy that opens a fresh counter per shot therefore tops out at a count of 3, while one that keeps one counter across shots reaches 6.
The author is a scripted transport with fixed replies: two strategies that keep the counter, one that does not, one module the contract lint refuses, and one reply with no module.

```text
  sample                   rejected  parent -
  one-shot                 pruned    parent sample selection Δ +0.000 on 6 tasks
  carry-forward            selected  parent sample selection Δ +0.284 on 12 tasks
  refused-module           invalid   parent sample refused: authored code rejected: foreign import — …
  refused-module~4         invalid   parent sample refused: the author reply carried no fenced ts module
  carry-forward-steered    pruned    parent sample selection Δ +0.346 on 6 tasks
claim: ship (finalist … beat the root on the 24 test units at confidence 0.95 (1 finalist, family-wise 0.95))
test lift 0.276 [0.195, 0.351] on 24 tasks
decision: ship (…); kept carry-forward
```

Run it again with the same `outDir` and the search continues from its ledger; a finished search returns the same report without running anything.
Print the ledger with `agent-eval search show <outDir>/<searchId>/ledger.jsonl`.

## A real author

Set `BRIDGE_URL`, `BRIDGE_BEARER` and `AUTHOR_MODEL` (a cli-bridge model id, default `claude-code/sonnet`) to have a model write the strategies through cli-bridge.
The worker stays offline, so the scores measure the authored strategies exactly.
Runtime refuses an author reply that does not report the model that served it, so the bridge backend must report its served model.

## Scope

The counter is a toy domain: the run proves the search, the measurement and the claim, not that the authored strategies help on a real task distribution.
`bench/src/swe-self-improve.mts` runs the same API on SWE-bench tasks.
