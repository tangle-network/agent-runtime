# define-loop

Developer-facing example of the blessed loop facade:

```ts
const loop = defineLoop({ run, analysts, verifier, judge })
const result = await loop.run(task)
```

This offline example drives a simulated user and product agent through
`runConversation`, records every turn as a loop artifact, runs an analyst, gates
success with a verifier, records a held-out judge score, and selects trace slices
for one agent and one pairwise interaction.

Run:

```bash
pnpm tsx examples/define-loop/define-loop.ts
```
