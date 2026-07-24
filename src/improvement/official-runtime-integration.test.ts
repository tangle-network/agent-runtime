import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JudgeConfig, Scenario } from '@tangle-network/agent-eval/campaign'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { improve } from './improve'
import { officialGepa, officialSkillOpt } from './official-optimizers'
import { startOptimizerModelServer } from './official-test-support'

interface OptimizerScenario extends Scenario {
  kind: 'official'
  prompt: string
}

interface OptimizerArtifact {
  text: string
}

const officialPython = process.env.AGENT_EVAL_TEST_PYTHON?.trim()
const officialIt = officialPython ? it : it.skip

officialIt(
  'runs Runtime through the installed GEPA package and promotes its candidate',
  async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'runtime-official-gepa-'))
    const modelServer = await startOptimizerModelServer('```\n{"k":2}\n```')
    const profile: AgentProfile = {
      name: 'official-gepa-runtime',
      prompt: { systemPrompt: '{"k":1}' },
    }

    try {
      const result = await improve(profile, {
        surface: 'prompt',
        executionRef: canonicalCandidateDigest({ fixture: 'official-gepa-runtime' }),
        method: officialGepa<OptimizerScenario, OptimizerArtifact>({
          objective: 'Return a JSON configuration whose k value is 2.',
          recipe: {
            kind: 'engine',
            run: {
              engine: 'gepa',
              maxEvaluations: 4,
              maxProposerCostUsd: 1,
              maxConcurrency: 1,
              stopAtScore: 1,
              engineConfig: {
                engine: {
                  capture_stdio: false,
                  max_workers: 1,
                  parallel: false,
                  raise_on_exception: true,
                  seed: 7,
                },
                reflection: {
                  reflection_minibatch_size: 1,
                  skip_perfect_score: false,
                },
              },
            },
          },
          optimizer: optimizerModel(modelServer.baseUrl, 2_000),
          runner: {
            command: officialPython!,
            args: ['-m', 'agent_eval_rpc.gepa_bridge'],
          },
        }),
        trainScenarios: [{ id: 'train', kind: 'official', prompt: 'Set k to 2.' }],
        selectionScenarios: [{ id: 'selection', kind: 'official', prompt: 'Set k to 2.' }],
        testScenarios: [
          { id: 'test-1', kind: 'official', prompt: 'Set k to 2.' },
          { id: 'test-2', kind: 'official', prompt: 'Set k to 2 again.' },
        ],
        agent: async (candidate) => ({ text: candidate.prompt?.systemPrompt ?? '' }),
        judges: [kEqualsTwoJudge],
        runDir,
        costCeiling: 1,
        seed: 7,
        resamples: 40,
        expectUsage: 'off',
        optimizationRunOptions: { expectUsage: 'off' },
      })

      expect(modelServer.requests).toHaveLength(1)
      expect(modelServer.requests[0]).toMatchObject({
        authorization: 'Bearer provider-secret',
        path: '/v1/chat/completions',
        body: { model: 'local-model', max_tokens: 2_000 },
      })
      expect(JSON.parse(String(result.candidate.value))).toEqual({ k: 2 })
      expect(result.decision).toBe('ship')
      expect(result.provenance).toMatchObject({
        source: { package: 'gepa', evidence: 'observed' },
        bridge: { package: 'agent-eval-rpc', evidence: 'observed' },
        tokenUsage: {
          inputTokens: 11,
          outputTokens: 13,
          totalTokens: 24,
          calls: 1,
        },
      })
      expect(result.cost.accountingComplete).toBe(true)
    } finally {
      await modelServer.close()
      await rm(runDir, { recursive: true, force: true })
    }
  },
  300_000,
)

officialIt(
  'runs Runtime through the installed SkillOpt package and promotes its candidate',
  async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'runtime-official-skillopt-'))
    const modelServer = await startOptimizerModelServer(
      JSON.stringify({
        batch_size: 1,
        failure_summary: [
          {
            count: 1,
            description: 'The required response rule is absent.',
            failure_type: 'missing_rule',
          },
        ],
        patch: {
          edits: [
            {
              content: '\n\n## Required Rule\nALWAYS_RETURN_READY\n',
              op: 'append',
            },
          ],
          reasoning: 'Add the missing response rule.',
        },
      }),
    )
    const profile: AgentProfile = {
      name: 'official-skillopt-runtime',
      resources: {
        failOnError: true,
        skills: [{ kind: 'inline', name: 'answering', content: '# Answering\nAnswer normally.\n' }],
      },
    }

    try {
      const result = await improve(profile, {
        surface: 'skills',
        skills: { resourceName: 'answering' },
        executionRef: canonicalCandidateDigest({ fixture: 'official-skillopt-runtime' }),
        method: officialSkillOpt<OptimizerScenario, OptimizerArtifact>({
          objective: 'Add the required response rule.',
          trainer: {
            epochs: 1,
            batchSize: 1,
            accumulation: 1,
            editBudget: 1,
            minEditBudget: 1,
            analystWorkers: 1,
            minibatchSize: 1,
            maxAnalystRounds: 1,
            evaluationWorkers: 1,
          },
          optimizer: optimizerModel(modelServer.baseUrl, 256),
          maxEvaluations: 3,
          runner: { command: officialPython! },
        }),
        trainScenarios: [{ id: 'train', kind: 'official', prompt: 'Return READY.' }],
        selectionScenarios: [{ id: 'selection', kind: 'official', prompt: 'Return READY.' }],
        testScenarios: [
          { id: 'test-1', kind: 'official', prompt: 'Return READY.' },
          { id: 'test-2', kind: 'official', prompt: 'Return READY again.' },
        ],
        agent: async (candidate) => {
          const skill = candidate.resources?.skills?.find(
            (entry) => entry.kind === 'inline' && entry.name === 'answering',
          )
          return { text: skill?.kind === 'inline' ? skill.content : '' }
        },
        judges: [requiredRuleJudge],
        runDir,
        costCeiling: 1,
        seed: 7,
        resamples: 40,
        expectUsage: 'off',
        optimizationRunOptions: { expectUsage: 'off' },
      })

      expect(modelServer.requests).toHaveLength(1)
      expect(modelServer.requests[0]).toMatchObject({
        authorization: 'Bearer provider-secret',
        path: '/v1/chat/completions',
        body: { model: 'local-model', max_tokens: 256 },
      })
      expect(String(result.candidate.value)).toContain('ALWAYS_RETURN_READY')
      expect(result.decision).toBe('ship')
      expect(result.provenance?.tokenUsage).toEqual({
        inputTokens: 11,
        outputTokens: 13,
        totalTokens: 24,
        calls: 1,
      })
      expect(result.cost.accountingComplete).toBe(true)
    } finally {
      await modelServer.close()
      await rm(runDir, { recursive: true, force: true })
    }
  },
  60_000,
)

const kEqualsTwoJudge: JudgeConfig<OptimizerArtifact, OptimizerScenario> = {
  name: 'k-equals-two',
  dimensions: [{ key: 'correctness', description: 'candidate sets k to 2' }],
  judgeVersion: 'k-equals-two/1',
  score: ({ artifact }) => {
    let score = 0
    try {
      const candidate = JSON.parse(artifact.text) as { k?: unknown }
      score = candidate.k === 2 ? 1 : 0
    } catch {
      score = 0
    }
    return {
      dimensions: { correctness: score },
      composite: score,
      notes: score ? '' : 'The candidate must be JSON with k set to 2.',
    }
  },
}

const requiredRuleJudge: JudgeConfig<OptimizerArtifact, OptimizerScenario> = {
  name: 'required-rule',
  dimensions: [{ key: 'correctness', description: 'candidate contains required rule' }],
  judgeVersion: 'required-rule/1',
  score: ({ artifact }) => {
    const score = artifact.text.includes('ALWAYS_RETURN_READY') ? 1 : 0
    return {
      dimensions: { correctness: score },
      composite: score,
      notes: score ? '' : 'The required response rule is absent.',
    }
  },
}

function optimizerModel(baseUrl: string, maxOutputTokensPerRequest: number) {
  return {
    model: 'local-model',
    baseUrl,
    apiKey: 'provider-secret',
    budget: {
      maxCostUsd: 1,
      maxRequests: 10,
      maxRequestBytes: 100_000,
      maxResponseBytes: 100_000,
      maxOutputTokensPerRequest,
      pricing: {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 2,
      },
    },
  }
}
