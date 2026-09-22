# Recursive Supervisor

This offline example shows the low-level worker tree behind `supervise()`.
A driver creates two child workers, waits for both results, and selects the highest-scoring valid result.

Every child reserves work from one shared budget before it starts.
The example sizes that budget for exactly two children, then proves a third child is refused.

Run it with:

```bash
pnpm tsx examples/recursive-supervisor/recursive-supervisor.ts
```

Expected output:

```text
Part 1: raw Supervisor (one driver, two children, one conserved pool)
third spawn admitted? no - budget-exhausted
winner: careful answer to "name the capital of France"
spent: 2 iterations, 100 tokens, 2 nodes in the tree
```

Use `supervise()` for application code.
Use these lower-level types only when implementing a custom coordination policy that `supervise()` cannot express.

| File | Purpose |
|---|---|
| `recursive-supervisor.ts` | Driver, shared budget, child creation, and result selection |
| `inline-executor.ts` | Scripted offline child execution |
