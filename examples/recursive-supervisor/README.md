# Run agents in parallel on one fixed compute budget — and never overspend

One "driver" agent launches several child agents at once to attack the same task, then keeps the
best answer. Every child is paid for out of a **single shared budget pool**, and the pool is
enforced at launch time: the moment a new child would push the run over its ceiling, the launch is
**refused** — no silent overspend, no one arm quietly getting more compute than another. That
last property is what makes A/B and tournament runs fair by construction: every arm draws from the
same capped pool.

This example runs the pattern twice — once written out by hand so you can see every moving part,
then again collapsed into a single-line helper — so you can see it's the same machine underneath.

## Why it matters

The usual way to fan an agent out over N attempts is a `for` loop with no accounting: any one
attempt can loop forever, burn the whole budget, and starve the others. Here the budget is a
resource that gets **reserved up front** per child and **fails closed** when it runs dry. You get
parallel attempts, a hard cost ceiling you can trust, and automatic selection of the best valid
result — the three things every "try it a few ways and keep the winner" workflow needs.

## How it works

Two roles, both just an `Agent` (an object with an `act()` method):

- A **leaf** is an agent that only produces an answer.
- A **driver** is an agent whose `act()` launches other agents (`scope.spawn(...)`), waits for them
  to finish (`scope.next()`), and picks a winner.

The driver in Part 1 spawns two leaves — `careful` (slow, high quality) and `fast` (cheap, lower
quality) — against a pool sized for exactly two. It then deliberately tries a third spawn the pool
can't cover, which comes back rejected. It drains both finished answers and keeps the highest-scoring
valid one.

Part 2 does the identical thing through `fanout(...)`, a one-line helper that spawns one child per
item in a list and returns the best result. Same spawn-drain-select machine, zero driver code — the
helper carries the *shape*, and you supply the *content* (here: three analyst angles on a stock).

## Run — fully offline, no key, no network

```bash
pnpm tsx examples/recursive-supervisor/recursive-supervisor.ts
```

The children are scripted stand-ins (fixed answers and token counts) so the whole thing runs on your
machine with no model call. You'll see:

```
— Part 1: raw Supervisor (one driver, two children, one conserved pool)
third spawn admitted? no — budget-exhausted
winner: careful answer to "name the capital of France"
spent: 2 iterations, 100 tokens, 2 nodes in the tree

— Part 2: the fanout combinator (same atom, zero driver code)
fanout deliverable: thesis-2 (best valid of 3 angles)
```

`third spawn admitted? no — budget-exhausted` is the fail-closed guarantee firing: the pool held two
children, the third was refused rather than allowed to overspend. `winner: careful ...` shows
selection keeping the higher-scoring arm.

## Make the children real

The scripted children plug into an open `Executor` port, so swapping them for real work is a
one-line change — pass a real executor instead of the mock:

- `createExecutor({ backend: 'router' })` — each child is one model call.
- `'router-tools'` — each child is a model that can call tools in a loop.
- `'sandbox'` — each child is a fresh cloud sandbox running its own agent loop.
- `'cli'` — each child shells out to a coding-agent CLI.
- Or pass any object implementing `Executor` — bring-your-own is first-class.

## Files

| file | what it is |
|---|---|
| `recursive-supervisor.ts` | the lesson: the driver, the budget pool, and the `fanout` helper |
| `inline-executor.ts` | the offline plumbing — a scripted child executor, kept out of the main file |
