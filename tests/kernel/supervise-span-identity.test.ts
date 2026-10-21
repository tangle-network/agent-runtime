/**
 * Every span a supervised run exports says who acted, and names the profile the spawn journal
 * recorded for the node the span belongs to. That join is the point: a trace reader groups work by
 * `agent.profile.digest` and lands on the exact AgentProfile the journal says ran, with no
 * runtime-specific reader.
 *
 * The run goes through the real front door (`supervise`) and the real OpenInference file exporter;
 * only the sandbox and the model are faked. Assertions read the exported file and the journal file.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { ATTR, validateTraceSpans } from '@tangle-network/agent-trace-contract'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { createOpenInferenceFileExporter } from '../../src/otel-export'
import type { SpawnEvent } from '../../src/runtime/supervise/contracts/spawn-journal'
import { supervise } from '../helpers/runtime-with-test-brain'
import { scriptedBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

type Spawned = Extract<SpawnEvent, { kind: 'spawned' }>
interface ExportedSpan {
  name: string
  attributes: Record<string, unknown>
}

function fakeSandboxClient() {
  let seq = 0
  return {
    async create(_options?: CreateSandboxOptions): Promise<SandboxInstance> {
      const id = `box-${seq++}`
      return {
        id,
        async *streamPrompt(): AsyncGenerator<SandboxEvent> {
          yield { type: 'result', data: { ok: true, text: 'done' } } as SandboxEvent
          yield { type: 'done', data: { outcome: { type: 'completed' } } } as SandboxEvent
        },
        async delete() {},
      } as unknown as SandboxInstance
    },
  }
}

const RUN_ID = 'identity-run'
const WORKER: AgentProfile = testAgentProfile('worker', {
  resources: { skills: [{ kind: 'inline', name: 'review', content: 'Review the diff.' }] },
})

describe('a supervised run says who acted on every span', () => {
  let runDir: string
  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'span-identity-'))
  })
  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true })
  })

  async function run(): Promise<{ spans: ExportedSpan[]; spawned: Spawned[] }> {
    const spansPath = join(runDir, 'spans.otlp.jsonl')
    const result = await supervise(
      testAgentProfile('root', {
        harness: 'cli-base',
        prompt: { systemPrompt: 'drive the worker' },
        tools: runtimeToolDeclarations('spawn_worker'),
      }),
      'solve it',
      {
        budget: { maxIterations: 100, maxTokens: 100_000 },
        runId: RUN_ID,
        runDir,
        backend: { backend: 'sandbox', sandboxClient: fakeSandboxClient() },
        brain: scriptedBrain([
          {
            toolCalls: [{ name: 'spawn_worker', arguments: { profile: WORKER, task: 'go' } }],
            usage: { input: 10, output: 5 },
          },
          { content: 'waiting for the worker', usage: { input: 10, output: 5 } },
          { content: 'done', usage: { input: 10, output: 5 } },
        ]),
        otel: { exporter: createOpenInferenceFileExporter(spansPath) },
      },
    )
    expect(result.kind).toBe('winner')
    const spans = (await readFile(spansPath, 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ExportedSpan)
    const events = await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree(RUN_ID)
    const spawned = (events ?? []).filter((event): event is Spawned => event.kind === 'spawned')
    return { spans, spawned }
  }

  it('stamps a profile digest on every exported span, and the validator can attribute the trace', async () => {
    const { spans } = await run()
    expect(spans.length).toBeGreaterThanOrEqual(3)
    for (const span of spans) {
      expect(span.attributes[ATTR.profileDigest], span.name).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
    const profileAttribution = validateTraceSpans(spans as never).capabilities.find(
      (capability) => capability.name === 'profile-attribution',
    )
    expect(profileAttribution).toEqual({ name: 'profile-attribution', available: true })
  })

  it('names the profile the journal recorded for the root and for each spawned node', async () => {
    const { spans, spawned } = await run()
    const rootEvent = spawned.find((event) => event.parent === undefined)
    const workerEvent = spawned.find((event) => event.parent !== undefined)
    expect(rootEvent?.identity?.profileDigest).toBeDefined()
    expect(workerEvent?.identity?.profileDigest).toBe(canonicalAgentProfileDigest(WORKER))

    const root = spans.find((span) => span.name === 'supervisor.run')
    expect(root?.attributes).toMatchObject({
      [ATTR.profileDigest]: rootEvent?.identity?.profileDigest,
      [ATTR.profileName]: 'root',
      [ATTR.agentModel]: 'offline-test-model',
      [ATTR.harness]: 'cli-base',
    })

    const worker = spans.find(
      (span) => span.attributes['tangle.supervise.node.id'] === workerEvent?.id,
    )
    expect(worker?.attributes).toMatchObject({
      [ATTR.profileDigest]: workerEvent?.identity?.profileDigest,
      [ATTR.profileName]: 'worker',
      [ATTR.agentModel]: 'offline-test-model',
      [ATTR.harness]: 'opencode',
      [ATTR.skillsDigest]: canonicalCandidateDigest(WORKER.resources?.skills),
    })

    // The root manager's own turns are the root's; nothing names a profile it did not run.
    for (const span of spans.filter((s) => s.name === 'gen_ai.client.inference')) {
      if (span.attributes['tangle.supervise.node.id'] === undefined) {
        expect(span.attributes[ATTR.profileDigest]).toBe(rootEvent?.identity?.profileDigest)
      }
    }
    // A profile with no skills and a run with no directive variant carry neither key.
    expect(root?.attributes[ATTR.skillsDigest]).toBeUndefined()
    for (const span of spans) expect(span.attributes[ATTR.directiveVariant]).toBeUndefined()
  })
})
