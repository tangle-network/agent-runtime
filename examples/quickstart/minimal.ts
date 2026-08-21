/**
 * minimal — the root-README quickstart, kept compiling by `pnpm typecheck:examples`.
 * One worker attempt, parsed and returned. Offline, deterministic, no API keys.
 *
 * Run:  pnpm build && pnpm tsx examples/quickstart/minimal.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  inProcessSandboxClient,
  runAgentRounds,
  type TerminalDecision,
} from '@tangle-network/agent-runtime/kernel'
import type { SandboxEvent } from '@tangle-network/sandbox'

const profile = {
  name: 'note-writer',
  harness: 'cli-base',
  model: { provider: 'scripted', default: 'scripted/note-writer' },
} satisfies AgentProfile

// A scripted worker. Swap in a sandbox, CLI-harness, or router backend later.
const worker = inProcessSandboxClient({
  onPrompt: (): SandboxEvent[] => [
    { type: 'result', data: { result: { note: 'Shipped one-click restore.' } } },
    { type: 'done', data: { outcome: { type: 'completed' } } },
  ],
})

const result = await runAgentRounds({
  task: 'Write a one-line release note for one-click restore.',
  driver: {
    // plan returns the tasks to run this iteration; [] means no more work.
    plan: async (task, history) => (history.length === 0 ? [task] : []),
    // 'done' is one of the four kernel keywords in TERMINAL_DECISIONS.
    decide: (): TerminalDecision => 'done',
  },
  agentRun: { profile, taskToPrompt: (t) => t },
  output: { parse: (events) => events },
  ctx: { sandboxClient: worker },
})

console.log(`decision: ${result.decision} — ${result.iterations.length} iteration(s)`)
