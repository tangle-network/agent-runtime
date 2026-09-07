/**
 * A harness-brained child that declares Runtime coordination tools runs as a nested manager, and
 * a nested manager reaches those tools only through the coordination MCP `driveHarnessFromBackend`
 * attaches on the bridge wire. A backend with no such channel must refuse that child at the
 * spawn pre-flight — before an environment exists or budget is reserved — and say which backend
 * and which channel are missing, so the authoring manager can re-author instead of paying for a
 * child that silently lacks its declared tools. A caller-supplied `driveHarness` is the relay the
 * refusal points at, so the same child is admitted once one is present.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { fullProfileMaterialization } from '../../src/agent/profile-materialization'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { SuperviseOptions } from '../../src/runtime/supervise/supervise'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type { NodeId, SpawnEvent, SpawnJournal } from '../../src/runtime/supervise/types'
import { supervise } from '../helpers/runtime-with-test-brain'
import { runtimeToolDeclarations } from './test-agent-profile'

function recordingJournal(into: SpawnEvent[]): SpawnJournal {
  const journal = new InMemorySpawnJournal()
  return {
    loadTree: (root: NodeId) => journal.loadTree(root),
    beginTree: (root: NodeId, at: string) => journal.beginTree(root, at),
    appendEvent: async (root: NodeId, event: SpawnEvent) => {
      into.push(event)
      await journal.appendEvent(root, event)
    },
  }
}

/** A provider whose `create` is the box-creation boundary the refusal must stay in front of. */
function neverCreatingProvider(): { provider: AgentEnvironmentProvider; creates: () => number } {
  let creates = 0
  const provider: AgentEnvironmentProvider = {
    name: 'never-created',
    capabilities: () => ({}) as AgentEnvironmentCapabilities,
    async create() {
      creates += 1
      throw new Error('must not create an environment')
    },
  }
  return { provider, creates: () => creates }
}

const routerRoot: AgentProfile = {
  name: 'root',
  harness: 'cli-base',
  model: { provider: 'tangle-router', default: 'test' },
  prompt: { systemPrompt: 'Delegate.' },
  tools: runtimeToolDeclarations('spawn_worker'),
}

const spawnCapableChild = {
  name: 'lead',
  harness: 'codex',
  model: { provider: 'openai', default: 'test' },
  tools: runtimeToolDeclarations('spawn_worker'),
}

/** One root turn spawns the spawn-capable child; every later turn records what the root read. */
async function spawnLeadFromRoot(
  options: Omit<SuperviseOptions, 'budget' | 'perWorker' | 'journal' | 'runId'>,
): Promise<{ events: SpawnEvent[]; toolResults: string[] }> {
  const events: SpawnEvent[] = []
  const toolResults: string[] = []
  let turn = 0
  await supervise(routerRoot, 'Delegate.', {
    ...options,
    budget: { maxIterations: 8, maxTokens: 8_000 },
    perWorker: { maxIterations: 2, maxTokens: 1_000 },
    journal: recordingJournal(events),
    runId: 'coordination-channel-preflight',
    brain: async (messages) => {
      turn += 1
      if (turn === 1) {
        return {
          toolCalls: [
            {
              id: 'spawn',
              name: 'spawn_worker',
              arguments: JSON.stringify({
                profile: spawnCapableChild,
                task: 'lead the subtree',
                key: 'lead',
              }),
            },
          ],
        }
      }
      for (const message of messages) {
        if (typeof message.content === 'string') toolResults.push(message.content)
      }
      return { content: 'done', toolCalls: [] }
    },
  })
  return { events, toolResults }
}

describe('supervise coordination-channel pre-flight', () => {
  it('refuses a spawn-capable harness child on the provider backend before creating an environment', async () => {
    const { provider, creates } = neverCreatingProvider()

    const { events, toolResults } = await spawnLeadFromRoot({
      backend: { backend: 'provider', provider },
    })

    expect(creates()).toBe(0)
    expect(events.filter((event) => event.kind === 'spawned' && event.key === 'lead')).toEqual([])
    const refusal = toolResults.find((text) => text.includes('preflight-refused'))
    expect(refusal).toBeDefined()
    expect(refusal).toContain('unmountable-tool')
    expect(refusal).toContain('agent_runtime_coordination_spawn_worker')
    expect(refusal).toContain("'provider' backend")
    expect(refusal).toContain('coordination')
  })

  it('admits the same child once the caller supplies the driveHarness relay', async () => {
    const { provider } = neverCreatingProvider()
    const driveHarness: DriveHarness = async () => {}

    const { events, toolResults } = await spawnLeadFromRoot({
      backend: { backend: 'provider', provider },
      driveHarness,
      driveHarnessMaterialization: fullProfileMaterialization,
    })

    expect(toolResults.find((text) => text.includes('preflight-refused'))).toBeUndefined()
    expect(events.some((event) => event.kind === 'spawned' && event.key === 'lead')).toBe(true)
  })
})
