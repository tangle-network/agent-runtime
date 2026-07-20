# An agent that rewrites its own prompt — and can't fool itself

`improve()` takes an agent, a list of what went wrong, and produces a *better version of that agent* —
by rewriting one part of it (its system prompt, its tool list, its skills) and testing whether the new
version actually beats the old one. The catch that makes it trustworthy: the improved version is
only reviewable if it wins on **held-out examples it wasn't tuned on**. It never changes live state.

```bash
pnpm tsx examples/improve/improve.ts
```

Runs offline, no credentials.

## Why it matters

"Self-improving AI" usually means an agent that tweaks itself and declares victory. That's how you get
a change that looks great on the examples it was optimizing against and falls apart everywhere else.
`improve()` guards against exactly that: it splits your test cases, optimizes on one half, and only
accepts the change if it still wins on the other half it never saw. So improvement is *measured*, not
asserted, and a change that does not genuinely help is held.

## What it does, step by step

1. You hand it an agent profile, a set of **findings** (a plain read of what went wrong — e.g. "the
   agent under-specifies its answer format"), and which **surface** to improve (`'prompt'`, `'tools'`,
   `'skills'`, ...).
2. It proposes candidate rewrites of that surface, reflecting on the findings.
3. It scores each candidate on your test scenarios.
4. It runs the winner against a **held-out** slice of scenarios that weren't used to pick it.
5. It returns the frozen winner, decision, and lift. Approval and activation are separate operations.

## What you'll see

```
improve() proposed a detached prompt candidate and measured it on held-out scenarios …
decision: ship  lift: 1.000
candidate prompt: PROMOTED
live prompt unchanged: BASELINE
```

The starting prompt was `BASELINE`; the improved one is `PROMOTED`. `lift: 1.000` is how much better it
scored; `decision: ship` means the held-out check made the candidate eligible for review.

## How it stays offline

To run with no key, the moving parts are stubbed but the *machinery is real*: a scripted proposer
always suggests the winning rewrite, a deterministic judge scores it (the literal string `PROMOTED`
= 1.0, anything else = 0.0), and the "agent" echoes the candidate back while reporting token usage so
the integrity check sees a genuine run, not an empty stub. The gate, the held-out split, and the
promotion logic are the same code that runs live.

## Going live

Drop the scripted proposer and pass `llm: { apiKey, baseUrl, model }` — `improve()` then uses a real
model to reflect on the findings and propose rewrites. Keep the default held-out gate (don't set
`gate: 'none'`) so real evidence decides which candidates are eligible for review.

## Files

| file | what it is |
|---|---|
| `improve.ts` | the profile, the findings, the offline judge/proposer/agent, and the run |

Same path is exercised by `tests/improve.test.ts` (part of `pnpm test`).
