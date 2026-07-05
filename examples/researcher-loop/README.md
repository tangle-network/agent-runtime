# A research agent that can't leak one tenant's data into another's

Two research agents answer the same question in parallel. Each returns **structured findings** —
claims, each backed by a source quote and URL, plus a list of proposed knowledge-base writes. A
validator scores every answer on citation quality and enforces one hard rule: every finding must
stay inside the tenant (the isolated data namespace) the task was scoped to. One of the two agents
here leaks a finding into a **different** tenant's namespace, so the validator throws its *entire*
answer out — and the clean agent wins by default.

## Why it matters

"Let the agent research and write to the knowledge base" is where multi-tenant products get burned:
one bad write puts customer A's data in customer B's space. This example shows the guardrail that
makes that structurally impossible. The validator is a hard gate, not a warning — a single
out-of-namespace item rejects the whole result, so a leaky answer can never win and never gets
written. It also shows the **propose-don't-apply** contract: the winning agent returns
`proposedWrites` it *wants* to make, but nothing is written to the store until you approve it.

## How it works

1. `researcherProfile({ task })` hands you three things wired to work together: the system prompt for
   a research agent, the output parser that turns its reply into structured findings, and the
   validator that scores them.
2. A tiny **driver** launches two agents on the same question (a "fanout"), collects both answers,
   and asks the loop to pick the best valid one.
3. The validator scores each answer on citation density and per-claim evidence, and **hard-fails**
   any answer containing a claim tagged with a namespace other than the task's own
   (`example-tenant`). Candidate B tags one claim `other-tenant` → rejected whole.
4. Candidate A is the only valid answer left, so it wins. Its `proposedWrites` are returned for
   review; nothing is written.

## Run

```bash
# 1. Install the one optional package this example needs (the runtime does NOT depend on it —
#    domain packs are injected, not bundled, so it isn't installed by default):
pnpm add -D @tangle-network/agent-knowledge

# 2. Run it (fully offline — the two agent answers are scripted fixtures, no model call, no key):
pnpm tsx examples/researcher-loop/researcher-loop.ts
```

Expected output (the valid candidate wins; the namespace-leaking one is pruned before selection):

```
decision: pick-winner
iterations: 2
winner: iteration #0 (...)
  items (2):
    - [example-tenant] A caret range like `^1.2.3` allows changes that do not modify the left-most non-zero element.
    - [example-tenant] A tilde range like `~1.2.3` allows patch-level changes (>=1.2.3 <1.3.0).
  citations: 2
  proposedWrites: 1
    - insert into example-tenant
```

Both `items` carry `example-tenant` — the leaked candidate never reaches the winner. `proposedWrites: 1`
is the write the agent *proposes*; it is not applied.

## Make it real

Swap the scripted answer source for a live sandbox — `new Sandbox({ apiKey })` — and the loop creates
a real cloud sandbox per attempt, streams the research prompt into it, and parses the same structured
findings out. The validator, namespace firewall, and propose-don't-apply contract are unchanged.

## Files

| file | what it is |
|---|---|
| `researcher-loop.ts` | the lesson: the profile, the two-agent fanout, and winner selection |
| `synthetic-researcher.ts` | the offline fixtures — the two scripted answers (one clean, one leaky) |
