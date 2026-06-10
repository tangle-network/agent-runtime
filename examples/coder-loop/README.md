# coder-loop

`coderProfile()` + `runLoop()` + an inline fanout `Driver` — the smallest
end-to-end coder loop. Two parallel iterations attempt the same goal; the
validator scores test + typecheck + diff size; the kernel picks the
highest-scoring valid winner.

`runLoop` is the round-synchronous kernel: `driver.plan()` → N tasks → one
sandbox per iteration → `output.parse` → `validator.validate` →
`driver.decide`. For new recursive/multi-level work, prefer the reactive
`Scope`/`Supervisor` core and the personify combinators (`fanout` does this
example's topology generically) — see
[`examples/recursive-supervisor/`](../recursive-supervisor/).

## Topology

The driver is ~5 lines, hand-written in `coder-loop.ts`: a single-round
fanout whose `plan()` returns two copies of the task only when `history` is
empty (round 0), then `[]` forever after — it spawns N, scores, and picks; it
never refines. Each of the N tasks becomes its own iteration, and every
iteration runs the same `output.parse` → `validator.validate` pipeline
independently before the driver votes.

```mermaid
flowchart TD
  task["CoderTask\ngoal: add util.ts add(a,b)"] --> plan0

  subgraph round0["round 0 — driver.plan(task, history=[])"]
    plan0["inline fanout driver\nreturns [task, task]"]
  end

  plan0 --> reserve["kernel reserves 2 iteration slots\nrunBatch dispatches in parallel\n(bounded by maxConcurrency)"]

  reserve --> wA
  reserve --> wB

  subgraph A["iteration 0 — worker A"]
    direction TB
    wA["sandboxClient.create()\n→ box.streamPrompt()"] --> evA["events:\nllm_call (costUsd 0.0036)\nresult { branch util-add-A }"]
    evA --> parseA["output.parse → CoderOutput\ntyped arrow fn\nexport const add = (a:number,b:number):number"]
    parseA --> valA["validator.validate\ntests pass · typecheck PASS\ndiff 2 ≤ 50 · no forbidden paths"]
    valA --> verA["DefaultVerdict\nvalid = true · score ≈ 0.992"]
  end

  subgraph B["iteration 1 — worker B"]
    direction TB
    wB["sandboxClient.create()\n→ box.streamPrompt()"] --> evB["events:\nllm_call (costUsd 0.0036)\nresult { branch util-add-B }"]
    evB --> parseB["output.parse → CoderOutput\nuntyped params\nexport function add(a, b)"]
    parseB --> valB["validator.validate\ntests pass · typecheck FAIL (TS7006)\ndiff 3 ≤ 50"]
    valB --> verB["DefaultVerdict\nvalid = false · rejected"]
  end

  verA --> plan1
  verB --> plan1

  subgraph round1["round 1 — driver.plan(task, history=[2 done])"]
    plan1["returns []\nmoveKind = stop (no refine)"]
  end

  plan1 --> decide["driver.decide(history)\ndefaultSelector: filter valid,\nsort by verdict.score desc,\ntie-break iterationIndex asc"]

  decide --> winner["decision = pick-winner\nwinner = iteration 0 (A)"]
  verB -.->|invalid, dropped| decide

  verA -.->|costUsd 0.0036| cost
  verB -.->|costUsd 0.0036| cost
  cost["result.costUsd = 0.0072\n(sum of per-iteration costUsd)"]
  winner --> cost

  classDef win fill:#1b5e20,stroke:#2e7d32,color:#fff
  classDef lose fill:#5d1a1a,stroke:#b71c1c,color:#fff
  class verA,winner win
  class verB lose
```

## Run

```bash
pnpm tsx examples/coder-loop/coder-loop.ts
```

## What it shows

- How `coderProfile({ task, harness })` bundles `profile`, `taskToPrompt`,
  `output` (event-stream → `CoderOutput`), `validator` (test + typecheck +
  diff cap + forbidden-path enforcement), and `agentRunSpec` together.
- How a hand-written `Driver` (`plan` + `decide`) makes the kernel plan N
  parallel iterations and pick the winning output — the whole `Driver`
  contract is two functions.
- How the synthetic `sandboxClient` mirrors the production
  `@tangle-network/sandbox` `Sandbox` surface — swap it for `new Sandbox(...)`
  when you wire to production.
- How `result.winner` carries the typed `CoderOutput`, the verdict, and the
  iteration index — everything you need to merge the patch in CI.

## Wire to production

Swap the synthetic `sandboxClient` for:

```ts
import { Sandbox } from '@tangle-network/sandbox'

const sandboxClient = new Sandbox({ apiKey: process.env.TANGLE_API_KEY! })
```

Then `runLoop` creates a fresh sandbox per iteration via `sandboxClient.create()`
and streams the prompt through `box.streamPrompt(taskToPrompt(task))`. Each
iteration's events feed the same `output.parse` → `validator.validate`
pipeline.
