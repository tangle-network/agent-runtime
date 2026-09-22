import { runInteraction } from '@tangle-network/agent-runtime'
import { inProcessEnvironmentProvider } from '@tangle-network/agent-runtime/loops'

const author = inProcessEnvironmentProvider({
  name: 'author-local',
  onTurn: (_prompt, { round }) => [
    {
      type: 'result',
      data: {
        finalText:
          round === 0
            ? 'Deploy the change, then inspect the live version.'
            : 'Deploy the change, inspect the live version, and restore on failure.',
      },
    },
  ],
})

const reviewer = inProcessEnvironmentProvider({
  name: 'reviewer-local',
  onTurn: (prompt) => [
    {
      type: 'result',
      data: {
        finalText: prompt.includes('restore')
          ? 'APPROVED: rollback is explicit.'
          : 'Add an explicit rollback action.',
      },
    },
  ],
})

const result = await runInteraction({
  actors: [
    { name: 'author', profile: { name: 'author' }, provider: author },
    { name: 'reviewer', profile: { name: 'reviewer' }, provider: reviewer },
  ],
  prompt: 'Write a safe deployment plan.',
  policy: {
    maxTurns: 6,
    turnOrder: 'alternate',
    stopWhen: ({ lastTurn }) => lastTurn.text.startsWith('APPROVED:'),
  },
})

for (const turn of result.transcript) {
  console.log(`${turn.actor}: ${turn.text}`)
}
console.log(`stopped: ${result.halted.kind}`)
