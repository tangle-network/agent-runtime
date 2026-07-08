import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  addSourceText,
  defineReadinessSpec,
  initKnowledgeBase,
} from '@tangle-network/agent-knowledge'
import { describe, expect, it } from 'vitest'
import { runKnowledgeImprovementJob } from '../src/knowledge'
import type { SuperviseOptions } from '../src/runtime/supervise/supervise'
import type { SupervisorProfile } from '../src/runtime/supervise/supervisor-agent'
import type { SupervisedResult } from '../src/runtime/supervise/types'

async function withKb(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-knowledge-job-'))
  try {
    await initKnowledgeBase(root)
    await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function winner(): SupervisedResult<unknown> {
  return {
    kind: 'winner',
    out: { ok: true },
    outRef: 'out:1',
    tree: { nodes: [] },
    spentTotal: { iterations: 2, tokens: { input: 30, output: 12 }, usd: 0.004, ms: 75 },
  } as unknown as SupervisedResult<unknown>
}

function rootFromTask(task: unknown): string {
  const match = String(task).match(/^Knowledge base root: (.+)$/m)
  if (!match?.[1]) throw new Error(`missing KB root in task:\n${String(task)}`)
  return match[1]
}

async function writeRuntimeJobPage(root: string): Promise<void> {
  const source = await addSourceText(root, {
    uri: 'test://runtime-job',
    title: 'Runtime Job Source',
    text: 'The runtime knowledge improvement job updates candidate workspaces with source-backed evidence.',
    lastVerifiedAt: '2026-07-08T00:00:00.000Z',
    validUntil: '2027-07-08T00:00:00.000Z',
  })
  const page = join(root, 'knowledge', 'runtime-job.md')
  await mkdir(dirname(page), { recursive: true })
  await writeFile(
    page,
    [
      '---',
      'id: runtime-job',
      'title: Runtime Job',
      'sources:',
      `  - ${source.id}`,
      '---',
      '# Runtime Job',
      `The runtime knowledge improvement job updates candidate workspaces with source-backed evidence. [^${source.id}]`,
    ].join('\n'),
    'utf8',
  )
}

describe('runKnowledgeImprovementJob', () => {
  it('runs agent-knowledge improvement through a supervised runtime updater', async () => {
    await withKb(async (root) => {
      const measurements: unknown[] = []
      let captured:
        | {
            profile: SupervisorProfile
            task: unknown
            opts: SuperviseOptions
          }
        | undefined

      const result = await runKnowledgeImprovementJob({
        root,
        goal: 'Add runtime job knowledge',
        runId: 'runtime-job',
        strict: true,
        budget: { maxIterations: 2, maxTokens: 1000 },
        readinessCheck: async ({ root: candidateRoot }) => {
          try {
            const text = await readFile(join(candidateRoot, 'knowledge', 'runtime-job.md'), 'utf8')
            return { ready: text.includes('candidate workspace') }
          } catch {
            return { ready: false, summary: 'runtime job page missing' }
          }
        },
        runSupervised: async (profile, task, opts) => {
          captured = { profile, task, opts }
          const candidateRoot = rootFromTask(task)
          const page = join(candidateRoot, 'knowledge', 'runtime-job.md')
          await mkdir(dirname(page), { recursive: true })
          await writeFile(
            page,
            [
              '---',
              'id: runtime-job',
              'title: Runtime Job',
              '---',
              '# Runtime Job',
              'The runtime job updates the candidate workspace.',
            ].join('\n'),
            'utf8',
          )
          await expect(opts.deliverable?.check({})).resolves.toBe(true)
          return winner()
        },
        onMeasurement: (measurement) => measurements.push(measurement),
      })

      expect(result.promoted).toBe(true)
      expect(result.improvement.state.status).toBe('promoted')
      expect(captured?.profile.name).toBe('knowledge-research-supervisor')
      expect(captured?.task).toContain('Goal: Add runtime job knowledge')
      expect(captured?.task).toContain('Knowledge base root:')
      await expect(readFile(join(root, 'knowledge', 'runtime-job.md'), 'utf8')).resolves.toContain(
        'candidate workspace',
      )
      expect(result.measurement.updateCalls).toBe(1)
      expect(result.measurement.supervisedSpent).toMatchObject({
        iterations: 2,
        inputTokens: 30,
        outputTokens: 12,
        usd: 0.004,
        ms: 75,
      })
      expect(measurements).toHaveLength(1)
    })
  })

  it('uses the built-in agent-knowledge readiness check by default', async () => {
    await withKb(async (root) => {
      const readinessSpec = defineReadinessSpec({
        id: 'runtime-job',
        description: 'runtime knowledge improvement job is documented',
        query: 'runtime knowledge improvement job candidate workspaces',
        requiredFor: ['RuntimeJob'],
        confidenceNeeded: 0.1,
        minSources: 1,
        minHits: 1,
      })

      const result = await runKnowledgeImprovementJob({
        root,
        goal: 'Add runtime job knowledge',
        runId: 'runtime-job-default-readiness',
        strict: true,
        readinessSpecs: [readinessSpec],
        budget: { maxIterations: 2, maxTokens: 1000 },
        runSupervised: async (_profile, task, opts) => {
          await writeRuntimeJobPage(rootFromTask(task))
          await expect(opts.deliverable?.check({})).resolves.toBe(true)
          return winner()
        },
      })

      expect(result.promoted).toBe(true)
      await expect(readFile(join(root, 'knowledge', 'runtime-job.md'), 'utf8')).resolves.toContain(
        'source-backed evidence',
      )
    })
  })
})
