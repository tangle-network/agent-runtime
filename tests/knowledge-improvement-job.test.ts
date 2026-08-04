import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
  type AgentImprovementActivationResult,
  canonicalCandidateDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
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
import { executeAgentImprovementActivation } from '../src/intelligence/activation'
import {
  createAgentImprovementActivation,
  createAgentImprovementProposal,
  reviewAgentImprovementProposal,
  runAgentCandidateExperiment,
} from '../src/intelligence/improvement-cycle'
import {
  buildKnowledgeImprovementExperimentBundles,
  createKnowledgeImprovementActivationExecutor,
  runKnowledgeImprovementJob,
} from '../src/knowledge'
import type { SuperviseOptions } from '../src/runtime/supervise/supervise'
import type { SupervisorProfile } from '../src/runtime/supervise/supervisor-agent'
import type { SupervisedResult } from '../src/runtime/supervise/types'
import {
  candidateBundle,
  cleanupCandidateFixtures,
  createCandidateOutputFixture,
} from './helpers/candidate-execution-fixture'
import {
  cleanupCandidateExperimentFixtures,
  createCandidateExperimentFixture,
} from './helpers/candidate-experiment-fixture'

const supervisorProfile: SupervisorProfile = {
  name: 'knowledge-research-supervisor',
  harness: 'cli-base',
  model: { provider: 'test-provider', default: 'test-supervisor' },
}

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

const KNOWLEDGE_IMPROVEMENT_JOB_TEST_TIMEOUT_MS = 60_000

describe('runKnowledgeImprovementJob', () => {
  it(
    'leaves the live knowledge base byte-identical until activation',
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
          implementationRef: canonicalCandidateDigest({ fixture: 'runtime-job' }),
          runId: 'runtime-job',
          strict: true,
          budget: { maxIterations: 2, maxTokens: 1000 },
          supervisorProfile,
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

        expect(result.improvement.promoted).toBe(false)
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
        expect(result.knowledge?.reference.candidateId).toBe(
          result.improvement.candidate?.candidateId,
        )
        await withKnowledgeImprovementCandidate(
          { root, candidate: knowledgeImprovementCandidateRef(result.improvement) },
          async ({ root: candidateRoot }) => {
            expect(result.knowledge?.reference.candidateHash).toBe(
              `sha256:${await hashKnowledgeBase(candidateRoot)}`,
            )
          },
        )
        expect(result.knowledge?.candidate.material.files).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: 'knowledge/runtime-job.md' })]),
        )
        expect(result.knowledge?.baseline.material.files).not.toEqual(
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
          implementationRef: canonicalCandidateDigest({
            fixture: 'runtime-job-default-readiness',
          }),
          runId: 'runtime-job-default-readiness',
          strict: true,
          readinessSpecs: [readinessSpec],
          budget: { maxIterations: 2, maxTokens: 1000 },
          supervisorProfile,
          runSupervised: async (_profile, task, opts) => {
            await writeRuntimeJobPage(rootFromTask(task))
            await expect(opts.deliverable?.check({})).resolves.toBe(true)
            return winner()
          },
        })

        expect(result.improvement.promoted).toBe(false)
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
    'applies and restores only frozen candidate bytes through one activation result path',
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
          implementationRef: canonicalCandidateDigest({ fixture: 'runtime-job-approved' }),
          runId: 'runtime-job-approved',
          strict: true,
          budget: { maxIterations: 2, maxTokens: 1000 },
          supervisorProfile,
          readinessCheck: async ({ root: candidateRoot }) => ({
            ready: await readFile(join(candidateRoot, 'knowledge', 'runtime-job.md'), 'utf8')
              .then((text) => text.includes('source-backed evidence'))
              .catch(() => false),
          }),
          runSupervised: update,
          candidateArtifacts: artifacts,
        })
        const knowledge = proposed.knowledge
        if (!knowledge) throw new Error('expected frozen knowledge candidate')
        const candidateRef = knowledgeImprovementCandidateRef(proposed.improvement)
        const candidateBytes = await withKnowledgeImprovementCandidate(
          { root, candidate: candidateRef },
          ({ root: candidateRoot }) => liveKnowledgeBytes(candidateRoot),
        )
        const liveBeforeApproval = await liveKnowledgeBytes(root)
        const baseBundle = candidateBundle()
        const bundles = buildKnowledgeImprovementExperimentBundles(baseBundle, knowledge)
        const rig = createCandidateExperimentFixture({
          baseline: bundles.baseline,
          candidate: bundles.candidate,
          scoreForRequest: (request) => {
            const page = request.knowledge?.files.find(
              (file) => file.path === 'knowledge/runtime-job.md',
            )
            return page &&
              Buffer.from(page.bytes).toString('utf8').includes('source-backed evidence')
              ? 1
              : 0
          },
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
          intent: 'activate-candidate',
          targets: [
            {
              surface: 'knowledge',
              identity: root,
            },
          ],
          fundingOwner: 'tenant/default',
          authorizedBy: 'operator@example.com',
          expiresAt: '2026-07-14T00:00:00.000Z',
          now: () => new Date('2026-07-13T01:02:00.000Z'),
        })

        expect(await liveKnowledgeBytes(root)).toEqual(liveBeforeApproval)
        const stored = new Map<Sha256Digest, AgentImprovementActivationResult>()
        let failNextResultWrite = false
        const activationExecutor = createKnowledgeImprovementActivationExecutor({
          root,
          identity: root,
          now: () => new Date('2026-07-13T01:02:59.000Z'),
          results: {
            async load(idempotencyKey) {
              return stored.get(idempotencyKey)
            },
            async putIfAbsent(result) {
              if (failNextResultWrite) {
                failNextResultWrite = false
                throw new Error('result store response was lost')
              }
              const existing = stored.get(result.idempotencyKey)
              if (existing) return existing
              stored.set(result.idempotencyKey, result)
              return result
            },
          },
        })

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

        const applied = await executeAgentImprovementActivation(
          { proposal, review, activation },
          {
            ...activationExecutor,
            now: () => new Date('2026-07-13T01:03:00.000Z'),
          },
        )

        expect(applied.outcome.status).toBe('applied')
        expect(applied.completedAt).toBe('2026-07-13T01:03:00.000Z')
        expect(await liveKnowledgeBytes(root)).toEqual(candidateBytes)
        expect(`sha256:${await hashKnowledgeBase(root)}`).toBe(knowledge.reference.candidateHash)

        const restore = createAgentImprovementActivation(proposal, review, {
          intent: 'restore-baseline',
          targets: [
            {
              surface: 'knowledge',
              identity: root,
            },
          ],
          fundingOwner: 'tenant/default',
          authorizedBy: 'operator@example.com',
          expiresAt: '2026-07-14T00:00:00.000Z',
          now: () => new Date('2026-07-13T01:05:00.000Z'),
        })
        const restored = await executeAgentImprovementActivation(
          { proposal, review, activation: restore },
          {
            ...activationExecutor,
            now: () => new Date('2026-07-13T01:06:00.000Z'),
          },
        )

        expect(restored.outcome.status).toBe('applied')
        expect(await liveKnowledgeBytes(root)).toEqual(liveBeforeApproval)
        expect(`sha256:${await hashKnowledgeBase(root)}`).toBe(knowledge.reference.baseHash)
        await expect(
          executeAgentImprovementActivation(
            { proposal, review, activation: restore },
            {
              ...activationExecutor,
              now: () => new Date('2026-07-13T01:07:00.000Z'),
            },
          ),
        ).resolves.toEqual(restored)

        const reapply = createAgentImprovementActivation(proposal, review, {
          intent: 'activate-candidate',
          targets: [
            {
              surface: 'knowledge',
              identity: root,
            },
          ],
          fundingOwner: 'tenant/default',
          authorizedBy: 'operator@example.com',
          expiresAt: '2026-07-13T01:09:30.000Z',
          now: () => new Date('2026-07-13T01:08:00.000Z'),
        })
        failNextResultWrite = true
        const uncertain = await executeAgentImprovementActivation(
          { proposal, review, activation: reapply },
          {
            ...activationExecutor,
            now: () => new Date('2026-07-13T01:09:00.000Z'),
          },
        )
        expect(uncertain.outcome.status).toBe('indeterminate')
        expect(`sha256:${await hashKnowledgeBase(root)}`).toBe(knowledge.reference.candidateHash)

        const restoreAfterLostResponse = createAgentImprovementActivation(proposal, review, {
          intent: 'restore-baseline',
          targets: [
            {
              surface: 'knowledge',
              identity: root,
            },
          ],
          fundingOwner: 'tenant/default',
          authorizedBy: 'operator@example.com',
          expiresAt: '2026-07-13T01:11:00.000Z',
          now: () => new Date('2026-07-13T01:09:05.000Z'),
        })
        const restoredAfterLostResponse = await executeAgentImprovementActivation(
          { proposal, review, activation: restoreAfterLostResponse },
          {
            ...activationExecutor,
            now: () => new Date('2026-07-13T01:09:10.000Z'),
          },
        )
        expect(restoredAfterLostResponse.outcome.status).toBe('applied')
        expect(`sha256:${await hashKnowledgeBase(root)}`).toBe(knowledge.reference.baseHash)

        const reconciled = await executeAgentImprovementActivation(
          { proposal, review, activation: reapply },
          {
            ...activationExecutor,
            now: () => new Date('2026-07-13T01:10:00.000Z'),
          },
        )
        expect(reconciled.outcome.status).toBe('applied')
        expect(stored.get(reapply.digest)).toEqual(reconciled)
        expect(`sha256:${await hashKnowledgeBase(root)}`).toBe(knowledge.reference.baseHash)

        const expiredRestore = createAgentImprovementActivation(proposal, review, {
          intent: 'restore-baseline',
          targets: [
            {
              surface: 'knowledge',
              identity: root,
            },
          ],
          fundingOwner: 'tenant/default',
          authorizedBy: 'operator@example.com',
          expiresAt: '2026-07-13T01:12:00.000Z',
          now: () => new Date('2026-07-13T01:11:00.000Z'),
        })
        const expired = await executeAgentImprovementActivation(
          { proposal, review, activation: expiredRestore },
          {
            ...activationExecutor,
            now: () => new Date('2026-07-13T01:12:00.000Z'),
          },
        )
        expect(expired.outcome.status).toBe('expired')
        expect(stored.has(expiredRestore.digest)).toBe(false)
        expect(`sha256:${await hashKnowledgeBase(root)}`).toBe(knowledge.reference.baseHash)
      })
    },
    KNOWLEDGE_IMPROVEMENT_JOB_TEST_TIMEOUT_MS,
  )
})
