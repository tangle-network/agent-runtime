# Test your agent against a simulated user, not a static prompt

Real users don't send one clean question — they push back, rephrase, and go off-script. This example
evaluates an agent the way a user actually behaves: it runs your **agent under test** against a
**persona** (a simulated user) over a back-and-forth conversation, then scores the transcript. It
shows three flavors, from a fixed script to an adversarial user that improvises to try to break your
agent's policy.

## Why it matters

Single-shot prompt tests miss the failures that only show up in a conversation: the agent that caves
on turn 4 after the user rephrases, or contradicts its own policy under pressure. Persona evals catch
those. And because the whole thing is built on swappable seams, you can run it deterministically
offline in CI **or** point it at a live model for adversarial pressure — same harness, no rewrite.

## How it works

`runPersonaConversation` is the loop runner. You give it a worker `AgentProfile` (the agent under
test), a persona, and two small seams — `backendFor` (turn a profile into something runnable, here a
router endpoint) and `systemPromptOf` (render its system prompt). The example runs three cells,
smallest to largest (`product-eval.ts`):

1. **Scripted persona** — the user follows a fixed list of turns. Deterministic, repeatable.
2. **Adversarial persona** — a model plays a frustrated user improvising to make the agent break
   policy. `maxTurns` is a **ceiling** (a hard backstop — `maxTurns: 0` means zero turns, not
   run-forever), and `haltOn` is the "stop the moment the goal is met" early exit.
3. **Scored matrix** — `runPersonaDispatch` turns the persona loop into a grid cell so you can run it
   across many profiles × scenarios at once, with per-cell cost metering.

## Run it — needs a router key

```bash
TANGLE_API_KEY=<router key> pnpm tsx examples/product-eval/product-eval.ts
```

Optional env: `WORKER_MODEL` (the agent under test, default `gpt-4o-mini`), `ROUTER_BASE`. You'll see:

```
[scripted] turns=2 cost=$0.0009
[adversarial] halted=<halt reason> turns=<n>
[scored] records=1
```

## See it work — no API key needed

The whole loop takes a fake `backendFor`, so it runs with no credentials and no network. That offline
path is exercised by the test suite (part of `pnpm test`):

```bash
pnpm test src/conversation/run-persona.test.ts
```

## Files

| File | What's in it |
|---|---|
| `product-eval.ts` | The three cells: scripted, adversarial, and scored-matrix persona evals |
| `README.md` | This file |

## Honest scope

The live run calls a real model per turn, so it costs money and needs a router key. Cell 3 scores a
placeholder metric (how many turns the agent answered) — swap `artifactOf` for your real transcript
scorer to make it a genuine eval.
