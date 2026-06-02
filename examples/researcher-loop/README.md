# researcher-loop

`researcherProfile()` + `runLoop()` + `createFanoutVoteDriver()` — the
researcher-flavoured counterpart to [`coder-loop`](../coder-loop). Two
parallel researcher iterations attempt the same question; the validator
scores citation density + namespace scoping + per-item provenance; the
kernel picks the highest-scoring valid winner.

Same `runLoop` fanout-vote kernel as [`coder-loop`](../coder-loop), only the
profile differs. The load-bearing branch below is candidate B: it leaks an
item into `other-tenant`, so the validator hard-fails the entire output and
the kernel prunes it — leaving A as the sole winner.

```mermaid
flowchart TD
  task["ResearchTask<br/>knowledgeNamespace = 'example-tenant'"] --> driver

  driver["createFanoutVoteDriver n=2<br/>driver.plan round 0 → 2 identical ResearchTasks"]
  driver --> wA
  driver --> wB

  subgraph A["worker A · sandbox-researcher-1"]
    wA["sandboxClient.create → streamPrompt"] --> evA["llm_call cost event<br/>result event → ResearchOutput"]
    evA --> parseA["output.parse → ResearchOutput<br/>items[] citations[] proposedWrites[]"]
    parseA --> valA{"researcherProfile validator<br/>citation density · provenance · namespace scope"}
    valA -->|"all items in 'example-tenant'<br/>evidence + citations present"| okA["valid · scored"]
  end

  subgraph B["worker B · sandbox-researcher-2"]
    wB["sandboxClient.create → streamPrompt"] --> evB["llm_call cost event<br/>result event → ResearchOutput"]
    evB --> parseB["output.parse → ResearchOutput<br/>item sv-leak-1 namespace 'other-tenant'"]
    parseB --> valB{"researcherProfile validator<br/>citation density · provenance · namespace scope"}
    valB -->|"namespace LEAK: 'other-tenant' ≠ task namespace"| failB["HARD-FAIL · invalid<br/>entire output rejected"]
  end

  okA --> decide{"decide / defaultSelector<br/>highest-scoring valid candidate"}
  failB -. pruned at validation .-> decide

  decide -->|winner = A| winner["result.winner<br/>output.proposedWrites[] carried<br/>propose-don't-apply: nothing written"]
  decide -. B rejected .-> dead["no merge"]
```

## Run

```bash
pnpm tsx examples/researcher-loop/researcher-loop.ts
```

The `@tangle-network/agent-knowledge` peer dep ships in `node_modules`
already; the example imports `researcherProfile` from
`@tangle-network/agent-knowledge/profiles`.

## What it shows

- How `researcherProfile({ task })` bundles the canonical knowledge-research
  preset (system prompt, validator, output adapter) with an
  `AgentRunSpec<ResearchTask>` the kernel consumes.
- How the validator hard-fails namespace leaks: the second synthetic
  iteration emits an item under `other-tenant` instead of
  `task.knowledgeNamespace`, and the kernel rejects it.
- How `result.winner.output` carries `items[]` + `citations[]` +
  `proposedWrites[]` — the propose-don't-apply contract the knowledge
  substrate enforces.

## Wire to production

Swap the synthetic `sandboxClient` for `new Sandbox({ apiKey })` and the
kernel creates a real sandbox per iteration, streams the researcher prompt
through `box.streamPrompt(taskToPrompt(task))`, and parses the canonical
`result` event payload via `researcherProfile().output.parse`.
