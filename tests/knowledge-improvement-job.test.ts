import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { AgentImprovementActivation } from '@tangle-network/agent-interface'
import {
  addSourceText,
  defineReadinessSpec,
  hashKnowledgeBase,
  initKnowledgeBase,
  knowledgeImprovementCandidateRef,
  withKnowledgeImprovementCandidate,
} from '@tangle-network/agent-knowledge'
import { afterEach, describe, expect, it } from 'vitest'
import { createAgentCandidateWorkspacePort } from '../src/candidate-execution/workspace-archive'
import {
  createAgentImprovementActivation,
  createAgentImprovementProposal,
  reviewAgentImprovementProposal,
  runAgentCandidateExperiment,
} from '../src/intelligence/improvement-cycle'
import { runKnowledgeImprovementJob } from '../src/knowledge'
import type { SuperviseOptions } from '../src/runtime/supervise/supervise'
import type { SupervisorProfile } from '../src/runtime/supervise/supervisor-agent'
import type { SupervisedResult } from '../src/runtime/supervise/types'
import {
  candidateBundle,
  cleanupCandidateFixtures,
  createCandidateOutputFixture,
  redigestCandidateBundle,
} from './helpers/candidate-execution-fixture'
import {
  cleanupCandidateExperimentFixtures,
  createCandidateExperimentFixture,
} from './helpers/candidate-experiment-fixture'

afterEach(() => {
  cleanupCandidateExperimentFixtures()
  cleanupCandidateFixtures()
})

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
    spentTotal: {
      iterations: 2,
      tokens: { input: 30, output: 12 },
      usdKnown: false,
      usd: 0.004,
      ms: 75,
    },
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

async function liveKnowledgeBytes(root: string): Promise<Record<string, string>> {
  const paths = [join(root, 'knowledge'), join(root, 'raw')]
  const sourceRegistry = join(root, '.agent-knowledge', 'sources.json')
  const output: Record<string, string> = {}
  for (const path of paths) await collectFiles(root, path, output)
  try {
    output[relative(root, sourceRegistry)] = (await readFile(sourceRegistry)).toString('base64')
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  return output
}

async function collectFiles(
  root: string,
  path: string,
  output: Record<string, string>,
): Promise<void> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(path)
  } catch (error) {
    if (isMissingFile(error)) return
    throw error
  }
  if (info.isFile()) {
    output[relative(root, path)] = (await readFile(path)).toString('base64')
    return
  }
  for (const entry of (await readdir(path)).sort()) {
    await collectFiles(root, join(path, entry), output)
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

const KNOWLEDGE_IMPROVEMENT_JOB_TEST_TIMEOUT_MS = 15_000

describe('runKnowledgeImprovementJob', () => {
  it(
    'leaves the live knowledge base byte-identical until approval',
    async () => {
      await withKb(async (root) => {
        const measurements: unknown[] = []
        const before = await liveKnowledgeBytes(root)
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
              const text = await readFile(
                join(candidateRoot, 'knowledge', 'runtime-job.md'),
                'utf8',
              )
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

        expect(result.promoted).toBe(false)
        expect(result.improvement.state.status).toBe('candidate-ready')
        expect(captured?.profile.name).toBe('knowledge-research-supervisor')
        expect(captured?.task).toContain('Goal: Add runtime job knowledge')
        expect(captured?.task).toContain('Knowledge base root:')
        await expect(
          readFile(join(root, 'knowledge', 'runtime-job.md'), 'utf8'),
        ).rejects.toMatchObject({
          code: 'ENOENT',
        })
        expect(await liveKnowledgeBytes(root)).toEqual(before)
        expect(result.candidateKnowledge?.candidate.candidateId).toBe(
          result.improvement.candidate?.candidateId,
        )
        await withKnowledgeImprovementCandidate(
          { root, candidate: knowledgeImprovementCandidateRef(result.improvement) },
          async ({ root: candidateRoot }) => {
            expect(result.candidateKnowledge?.candidate.candidateHash).toBe(
              `sha256:${await hashKnowledgeBase(candidateRoot)}`,
            )
          },
        )
        expect(result.candidateKnowledge?.snapshot.material.files).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: 'knowledge/runtime-job.md' })]),
        )
        expect(result.measurement.updateCalls).toBe(1)
        expect(result.measurement.supervisedSpent).toMatchObject({
          iterations: 2,
          inputTokens: 30,
          outputTokens: 12,
          usdKnown: false,
          usd: 0.004,
          ms: 75,
        })
        expect(measurements).toHaveLength(1)
      })
    },
    KNOWLEDGE_IMPROVEMENT_JOB_TEST_TIMEOUT_MS,
  )

  it(
    'uses the built-in agent-knowledge readiness check by default',
    async () => {
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

        expect(result.promoted).toBe(false)
        await withKnowledgeImprovementCandidate(
          { root, candidate: knowledgeImprovementCandidateRef(result.improvement) },
          async ({ root: candidateRoot }) => {
            await expect(
              readFile(join(candidateRoot, 'knowledge', 'runtime-job.md'), 'utf8'),
            ).resolves.toContain('source-backed evidence')
          },
        )
        await expect(
          readFile(join(root, 'knowledge', 'runtime-job.md'), 'utf8'),
        ).rejects.toMatchObject({
          code: 'ENOENT',
        })
      })
    },
    KNOWLEDGE_IMPROVEMENT_JOB_TEST_TIMEOUT_MS,
  )

  it(
    'promotes only the frozen candidate bytes after an exact approved review',
    async () => {
      await withKb(async (root) => {
        const artifacts = createCandidateOutputFixture().outputArtifacts
        const update = async (
          _profile: SupervisorProfile,
          task: unknown,
          opts: SuperviseOptions,
        ) => {
          await writeRuntimeJobPage(rootFromTask(task))
          await expect(opts.deliverable?.check({})).resolves.toBe(true)
          return winner()
        }
        const proposed = await runKnowledgeImprovementJob({
          root,
          goal: 'Add runtime job knowledge',
          runId: 'runtime-job-approved',
          strict: true,
          budget: { maxIterations: 2, maxTokens: 1000 },
          readinessCheck: async ({ root: candidateRoot }) => ({
            ready: await readFile(join(candidateRoot, 'knowledge', 'runtime-job.md'), 'utf8')
              .then((text) => text.includes('source-backed evidence'))
              .catch(() => false),
          }),
          runSupervised: update,
          candidateArtifacts: artifacts,
        })
        const knowledge = proposed.candidateKnowledge
        if (!knowledge) throw new Error('expected frozen knowledge candidate')
        const candidateRef = knowledgeImprovementCandidateRef(proposed.improvement)
        const candidateBytes = await withKnowledgeImprovementCandidate(
          { root, candidate: candidateRef },
          ({ root: candidateRoot }) => liveKnowledgeBytes(candidateRoot),
        )
        const liveBeforeApproval = await liveKnowledgeBytes(root)
        const baseBundle = candidateBundle()
        const bundle = redigestCandidateBundle(baseBundle, { knowledge })
        const rig = createCandidateExperimentFixture({
          baseline: baseBundle,
          candidate: bundle,
          configureFixture: (fixture) => {
            fixture.ports.artifacts = artifacts
            const materialize = fixture.ports.workspaces.materialize
            const archivedWorkspaces = createAgentCandidateWorkspacePort()
            fixture.ports.workspaces.materialize = async (input) =>
              input.role === 'knowledge'
                ? archivedWorkspaces.materialize(input)
                : materialize(input)
          },
        })
        const measured = await runAgentCandidateExperiment({
          experiment: rig.experiment,
          runId: 'runtime-job-approved',
          placeCell: rig.placeCell,
        })
        const proposal = createAgentImprovementProposal({
          runId: 'runtime-job-approved',
          findings: [],
          evaluation: measured.evaluation,
          now: () => new Date('2026-07-13T01:00:00.000Z'),
        })
        const review = reviewAgentImprovementProposal(proposal, {
          decision: 'approve',
          reviewedBy: 'operator@example.com',
          reason: 'Approve the exact frozen knowledge candidate.',
          now: () => new Date('2026-07-13T01:01:00.000Z'),
        })
        const activation = createAgentImprovementActivation(proposal, review, {
          targets: [
            {
              surface: 'knowledge',
              identity: root,
              expectedBaseDigest: knowledge.candidate.baseHash,
            },
          ],
          fundingOwner: 'tenant/default',
          authorizedBy: 'operator@example.com',
          now: () => new Date('2026-07-13T01:02:00.000Z'),
        })

        expect(await liveKnowledgeBytes(root)).toEqual(liveBeforeApproval)
        const approvedUpdate = async () => {
          throw new Error('candidate-ready promotion must not rerun the updater')
        }
        const runApproved = (
          approvedProposal: typeof proposal,
          approvedReview: typeof review,
          approvedActivation: AgentImprovementActivation,
        ) =>
          runKnowledgeImprovementJob({
            root,
            goal: 'Add runtime job knowledge',
            runId: 'runtime-job-approved',
            strict: true,
            budget: { maxIterations: 2, maxTokens: 1000 },
            readinessCheck: async () => ({ ready: true }),
            runSupervised: approvedUpdate,
            candidateArtifacts: artifacts,
            approval: {
              proposal: approvedProposal,
              review: approvedReview,
              activation: approvedActivation,
              authorizeActivation: async (candidateActivation) =>
                candidateActivation.digest === approvedActivation.digest,
            },
          })
        const promoteApproved = () => runApproved(proposal, review, activation)

        await expect(
          withKnowledgeImprovementCandidate(
            { root, candidate: candidateRef },
            async ({ root: candidateRoot }) => {
              const frozenPage = join(candidateRoot, 'knowledge', 'runtime-job.md')
              await writeFile(frozenPage, 'tampered frozen snapshot', 'utf8')
            },
          ),
        ).rejects.toThrow(/snapshot changed during use/)
        expect(await liveKnowledgeBytes(root)).toEqual(liveBeforeApproval)

        const promoted = await promoteApproved()

        expect(promoted.promoted).toBe(true)
        expect(promoted.improvement.state.status).toBe('promoted')
        expect(promoted.measurement.updateCalls).toBe(0)
        expect(await liveKnowledgeBytes(root)).toEqual(candidateBytes)
        expect(`sha256:${await hashKnowledgeBase(root)}`).toBe(knowledge.candidate.candidateHash)
      })
    },
    KNOWLEDGE_IMPROVEMENT_JOB_TEST_TIMEOUT_MS,
  )
})
