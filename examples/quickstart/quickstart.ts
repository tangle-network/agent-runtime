/**
 * quickstart — the smallest complete agent loop. Offline, deterministic, no API keys.
 *
 * One driver runs a worker, reads the worker's real output, and writes the next prompt
 * from it until a check passes. The worker here is a scripted stand-in so the loop runs
 * anywhere; swap `inProcessSandboxClient` for a real sandbox, CLI-harness, or router
 * backend without changing the driver. This is the same shape as examples/driver-loop,
 * which annotates every seam.
 *
 * Run:  pnpm build && pnpm tsx examples/quickstart/quickstart.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { inProcessSandboxClient, runAgentRounds } from '@tangle-network/agent-runtime/kernel'
import type { SandboxEvent } from '@tangle-network/sandbox'

type Task = { prompt: string }
type Note = { note: string }

const noteWriterProfile = {
  name: 'note-writer',
  harness: 'cli-base',
  model: { provider: 'scripted', default: 'scripted/note-writer' },
} satisfies AgentProfile

// A stand-in worker: it obeys the prompt it is given. Swap for a real backend later.
const worker = inProcessSandboxClient({
  onPrompt: (prompt): SandboxEvent[] => [
    {
      type: 'result',
      data: {
        result: {
          note: prompt.includes('rollback')
            ? 'Shipped one-click restore with an instant rollback path.'
            : 'Shipped one-click restore.',
        },
      },
    },
  ],
})

const result = await runAgentRounds<Task, Note, 'refine' | 'pick-winner' | 'fail'>({
  task: { prompt: 'Write a one-line release note for one-click restore.' },
  driver: {
    name: 'refine',
    plan: async (task, history) => {
      const last = history[history.length - 1]
      if (!last) return [task] // shot 0: run the task as written
      if (last.verdict?.valid || history.length >= 3) return [] // done, or out of shots
      // The core move: read the last worker's real output, write the next prompt FROM it.
      return [{ prompt: `Rewrite "${last.output?.note}" to mention the rollback path.` }]
    },
    decide: (history) =>
      history.some((shot) => shot.verdict?.valid)
        ? 'pick-winner'
        : history.length < 3
          ? 'refine'
          : 'fail',
  },
  agentRun: { profile: noteWriterProfile, taskToPrompt: (t) => t.prompt },
  output: {
    parse: (events) => {
      for (const ev of events) {
        if (ev.type === 'result') {
          const r = (ev as { data?: { result?: unknown } }).data?.result
          if (r && typeof r === 'object' && 'note' in r) return r as Note
        }
      }
      return { note: '' }
    },
  },
  validator: {
    validate: async (out) => ({
      valid: out.note.includes('rollback'),
      score: out.note.includes('rollback') ? 1 : 0,
    }),
  },
  ctx: { sandboxClient: worker },
  maxIterations: 3,
})

for (const shot of result.iterations) {
  console.log(
    `shot ${shot.index}: ${shot.verdict?.valid ? 'PASS' : 'reject'} — "${shot.output?.note}"`,
  )
}
console.log(`decision: ${result.decision} — winner: shot ${result.winner?.iterationIndex}`)
