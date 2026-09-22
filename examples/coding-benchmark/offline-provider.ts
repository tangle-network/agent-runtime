/**
 * Credential-free provider for the coding benchmark.
 *
 * The scripted worker writes one solution per turn into a real temporary
 * workspace. Runtime supplies workspace reads, writes, commands, cancellation,
 * and cleanup through the same `AgentEnvironmentProvider` contract used live.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type AgentEnvironmentEvent,
  type AgentEnvironmentProvider,
  inProcessEnvironmentProvider,
} from '@tangle-network/agent-runtime/loops'

/** A scripted offline solution: which file, and what content to write on a given
 *  round. `solutionFor(round)` lets round N differ from round N-1 — a REAL refine
 *  demo, not a constant. */
export interface OfflineScript {
  path: string
  solutionFor: (round: number) => string
}

/** Each created environment gets its own temporary workspace and turn counter. */
export function offlineEnvironmentProvider(script: OfflineScript): AgentEnvironmentProvider {
  return inProcessEnvironmentProvider({
    name: 'coding-benchmark-offline',
    workspacePrefix: 'coding-bench',
    async onTurn(_prompt, context): Promise<AgentEnvironmentEvent[]> {
      if (!context.workdir) {
        throw new Error('coding benchmark offline provider requires a workspace')
      }
      const content = script.solutionFor(context.round)
      const absolutePath = join(context.workdir, script.path)
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, content, 'utf8')
      return [
        {
          type: 'done',
          data: {
            tokenUsage: { inputTokens: 600, outputTokens: 400 },
            totalCostUsd: 0,
            finalText: `wrote ${script.path} (offline round ${context.round + 1})`,
          },
        },
      ]
    },
  })
}
