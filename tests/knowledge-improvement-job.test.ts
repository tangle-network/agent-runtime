import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type {
  AgentCandidateBundle,
  AgentCandidateKnowledge,
  AgentImprovementMeasuredComparison,
  AgentProfile,
} from '@tangle-network/agent-interface'
import {
  addSourceText,
  defineReadinessSpec,
  hashKnowledgeBase,
  initKnowledgeBase,
  knowledgeImprovementCandidateRef,
  withKnowledgeImprovementCandidate,
} from '@tangle-network/agent-knowledge'
import { describe, expect, it } from 'vitest'
import { canonicalCandidateDigest } from '../src/candidate-execution/digest'
import { agentCandidateProfileAsAgentProfile } from '../src/candidate-execution/profile'
import {
  createAgentImprovementProposal,
  reviewAgentImprovementProposal,
} from '../src/intelligence/improvement-cycle'
import { runKnowledgeImprovementJob } from '../src/knowledge'
import type { SuperviseOptions } from '../src/runtime/supervise/supervise'
import type { SupervisorProfile } from '../src/runtime/supervise/supervisor-agent'
import type { SupervisedResult } from '../src/runtime/supervise/types'
import {
  candidateBundle,
  candidateSha,
  createCandidateOutputFixture,
  redigestCandidateBundle,
} from './helpers/candidate-execution-fixture'

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

function measuredKnowledgeComparison(
  baselineProfile: AgentProfile,
  bundle: AgentCandidateBundle,
): AgentImprovementMeasuredComparison {
  const confidenceInterval = {
    level: 0.95,
    lower: 0,
    upper: 0,
    method: 'paired-bootstrap' as const,
    statistic: 'mean' as const,
    resamples: 2_000,
  }
  return {
    schemaVersion: 1,
    kind: 'agent-improvement-measured-comparison',
    benchmark: { name: 'development', version: '1', splitDigest: candidateSha('f') },
    baselineProfileDigest: canonicalCandidateDigest(baselineProfile),
    candidateBundleDigest: bundle.digest,
    overall: {
      name: 'composite',
      baseline: 0,
      candidate: 1,
      delta: 1,
      confidenceInterval: { ...confidenceInterval, lower: 1, upper: 1 },
      n: 1,
      direction: 'higher-is-better',
      unit: 'score',
    },
    objectives: [
      {
        availability: 'measured',
        kind: 'objective',
        name: 'knowledge-readiness',
        baseline: 0,
        candidate: 1,
        delta: 1,
        confidenceInterval: { ...confidenceInterval, lower: 1, upper: 1 },
        n: 1,
        direction: 'higher-is-better',
        unit: 'score',
      },
      {
        availability: 'unavailable',
        kind: 'cost',
        name: 'cost',
        direction: 'lower-is-better',
        unit: 'usd',
        reason: 'This deterministic fixture does not measure cost.',
      },
      {
        availability: 'unavailable',
        kind: 'latency',
        name: 'latency',
        direction: 'lower-is-better',
        unit: 'milliseconds',
        reason: 'This deterministic fixture does not measure latency.',
      },
    ],
    candidate: { label: 'frozen knowledge candidate' },
    decision: {
      outcome: 'ship',
      reasons: ['The paired held-out comparison approved this exact knowledge candidate.'],
      contributingChecks: [{ name: 'heldout', passed: true }],
    },
    power: {
      sufficient: true,
      n: 1,
      minimumDetectableDelta: 0,
      confidenceLevel: 0.95,
      scaleAssumed: true,
      sharedScorerChannel: false,
      reason: 'Fixture measurement is deterministic.',
    },
    provenance: {
      kind: 'agent-eval-loop',
      schema: '1.0.0',
      runId: 'knowledge-heldout',
      recordDigest: candidateSha('1'),
      baselineContentHash: candidateSha('2'),
      candidateContentHash: candidateSha('3'),
    },
    diff: 'knowledge candidate bytes changed',
    evaluation: { generationsExplored: 1, durationMs: 1, totalCostUsd: 0 },
  }
}

describe('runKnowledgeImprovementJob', () => {
  it('leaves the live knowledge base byte-identical until approval', async () => {
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
  })

  it('promotes only the frozen candidate bytes after an exact approved review', async () => {
    await withKb(async (root) => {
      const artifacts = createCandidateOutputFixture().outputArtifacts
      const update = async (_profile: SupervisorProfile, task: unknown, opts: SuperviseOptions) => {
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
      const baselineProfile = agentCandidateProfileAsAgentProfile(baseBundle.profile)
      const bundle = redigestCandidateBundle(baseBundle, { knowledge })
      const proposal = createAgentImprovementProposal({
        runId: 'runtime-job-approved',
        baselineProfile,
        findings: [],
        evaluation: measuredKnowledgeComparison(baselineProfile, bundle),
        candidateBundle: bundle,
        now: () => new Date('2026-07-13T01:00:00.000Z'),
      })
      const mismatchedKnowledge: AgentCandidateKnowledge = {
        ...knowledge,
        candidate: { ...knowledge.candidate, candidateHash: candidateSha('0') },
      }
      const mismatchedBundle = redigestCandidateBundle(bundle, {
        knowledge: mismatchedKnowledge,
      })
      expect(() =>
        createAgentImprovementProposal({
          runId: 'runtime-job-mismatched',
          baselineProfile,
          findings: [],
          evaluation: measuredKnowledgeComparison(baselineProfile, bundle),
          candidateBundle: mismatchedBundle,
        }),
      ).toThrow(/measured comparison does not bind the exact candidate bundle/)
      const review = reviewAgentImprovementProposal(proposal, {
        decision: 'approve',
        reviewedBy: 'operator@example.com',
        reason: 'Approve the exact frozen knowledge candidate.',
        now: () => new Date('2026-07-13T01:01:00.000Z'),
      })

      expect(await liveKnowledgeBytes(root)).toEqual(liveBeforeApproval)
      const approvedUpdate = async () => {
        throw new Error('candidate-ready promotion must not rerun the updater')
      }
      const promoteApproved = () =>
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
            proposal,
            review,
            authorizeReview: async (candidateReview) => candidateReview.digest === review.digest,
          },
        })

      await withKnowledgeImprovementCandidate(
        { root, candidate: candidateRef },
        async ({ root: candidateRoot }) => {
          const frozenPage = join(candidateRoot, 'knowledge', 'runtime-job.md')
          const frozenPageBytes = await readFile(frozenPage)
          await writeFile(frozenPage, 'tampered frozen snapshot', 'utf8')
          await expect(promoteApproved()).rejects.toThrow(/snapshot changed after approval/)
          expect(await liveKnowledgeBytes(root)).toEqual(liveBeforeApproval)
          await writeFile(frozenPage, frozenPageBytes)
        },
      )

      const promoted = await promoteApproved()

      expect(promoted.promoted).toBe(true)
      expect(promoted.improvement.state.status).toBe('promoted')
      expect(promoted.measurement.updateCalls).toBe(0)
      expect(await liveKnowledgeBytes(root)).toEqual(candidateBytes)
      expect(`sha256:${await hashKnowledgeBase(root)}`).toBe(knowledge.candidate.candidateHash)
    })
  })
})
