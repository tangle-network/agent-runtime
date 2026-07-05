# Stop an agent before it acts on facts it doesn't have

An agent should not "review your tax return" if it doesn't actually know your filing status. This
example shows a runtime that **checks what a task needs to know before letting the agent do anything**,
refuses to start when a required fact is missing, and hands the agent the specific open question so it
can go get the answer (ask you, query a database) instead of guessing or silently failing. It runs
offline with no API key.

## Why it matters

The common agent failure isn't a bad answer — it's a confident answer built on a fact the agent never
had. This flips the default to **fail-closed on missing knowledge**: a task declares the facts it
depends on, the runtime scores whether those facts are present and confident enough, and a *blocking*
gap halts the run before the agent can act. You get a clean "I need X first" instead of a plausible
hallucination.

## How it works

A task carries a `requiredKnowledge` list. Each entry says what's needed, how confident the agent must
be (`confidenceNeeded`), and how bad it is to miss (`importance: 'blocking'` vs. optional). Before the
control loop runs, the runtime scores readiness. Two outcomes:

- **Missing a blocking fact** → the run is gated and the adapter's `onKnowledgeBlocked` hook fires,
  receiving the exact open questions. A real agent returns an action here ("ask the user", "query the
  connector") and re-scores; this demo just records the question it *would* ask and stops.
- **All facts present** → readiness passes and the agent's normal loop runs.

The agent itself is a tiny four-method `adapter` — `observe` (read state), `validate` (score it),
`decide` (continue or stop), `act` (apply an action) — the minimal shape any new domain agent starts
from. The knowledge gate sits in front of it; no knowledge provider is needed for the basic case.

## See it work — no API key needed

```bash
pnpm tsx examples/knowledge-gating/knowledge-gating.ts
```

Runs the same task twice — once with zero confidence in the filing status, once with full confidence:

```
blocked status: blocked
  readinessScore: 0
  recommendedAction: <ask the user>
  blocking gaps: [ 'filing-status' ]
  onKnowledgeBlocked → would ask the user: Taxpayer filing status

ready status: <completed>
  readinessScore: 1
  recommendedAction: <proceed>
```

## Files

| File | What's in it |
|---|---|
| `knowledge-gating.ts` | The minimal adapter, a task with a blocking requirement, and both the blocked and ready runs |
| `README.md` | This file |

## Optional: bring your own knowledge

The basic case needs no external provider. Pass an `AgentKnowledgeProvider` only when you want to pull
evidence from your own database before scoring, answer the open questions yourself, or run acquisition
steps and re-score. Every method has a default fallback, so it's fully opt-in.
