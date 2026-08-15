# Run on PrimeIntellect

`@tangle-network/agent-runtime/primeintellect` packages typed train and eval tasks as a PrimeIntellect Verifiers environment.
Prime launches your actual runtime program against an intercepted model endpoint, so `runPersonified`, `runAgentic`, product agents, tool calls, and multiple rounds stay intact.
Reference answers stay in Prime's task process and never enter the agent workspace.
The runner file must be one executable bundle that contains the app and its runtime dependencies.

## Package the tasks

```ts
import { readFile } from 'node:fs/promises'
import {
  createPrimeIntellectPackage,
  writePrimeIntellectPackage,
} from '@tangle-network/agent-runtime/primeintellect'

const bundledRunner = await readFile('./dist/prime-runner.mjs', 'utf8')
const bundle = createPrimeIntellectPackage({
  name: 'support-agent',
  version: '1.0.0',
  tasks: [
    {
      id: 'train-refund-policy',
      split: 'train',
      prompt: 'Can a subscription renewal be refunded?',
      answer: 'No',
    },
    {
      id: 'eval-final-sale',
      split: 'eval',
      prompt: 'Can a final-sale order be refunded?',
      answer: 'No',
    },
  ],
  scoring: { kind: 'exact', normalization: 'trim-casefold' },
  runner: {
    image: 'node:22-bookworm-slim',
    files: { 'runner.mjs': bundledRunner },
    command: ['node', 'runner.mjs'],
  },
})

await writePrimeIntellectPackage(bundle, './prime/support-agent')
```

## Write the runner

The runner reads the episode and uses the normal runtime APIs.
Here, `runProductAgent` is the application's existing entry point, not another loop supplied by this adapter.

```ts
import {
  primeIntellectExecutorConfig,
  runPrimeIntellectProgram,
} from '@tangle-network/agent-runtime/primeintellect'
import {
  collectAgentTurn,
  createExecutor,
  streamAgentTurn,
} from '@tangle-network/agent-runtime/kernel'

await runPrimeIntellectProgram(async (episode) => {
  const profile = makeProductProfile({ model: episode.model.name })
  return collectAgentTurn(
    streamAgentTurn(
      { kind: 'executor', profile, factory: createExecutor(primeIntellectExecutorConfig(episode)) },
      episode.task.prompt,
    ),
  )
})
```

## Read the traces back

Prime writes complete `traces.jsonl` rows.
Use `importPrimeIntellectTraces(...)` to convert them to agent-eval `RunRecord`s for the existing reports and release checks.
