import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  improve,
  officialGepa,
  officialSkillOpt,
} from '@tangle-network/agent-runtime'

const python = process.env.AGENT_EVAL_TEST_PYTHON?.trim()
if (!python) throw new Error('AGENT_EVAL_TEST_PYTHON is required')

async function main() {
  const mode = process.argv[2]
  if (mode === 'wheel') {
    await runWheelVerification()
    return
  }
  if (mode === 'omni') {
    await runOmniVerification()
    return
  }
  throw new Error(`expected verification mode "wheel" or "omni", found ${String(mode)}`)
}

async function runWheelVerification() {
  const gepaRunDir = await mkdtemp(join(tmpdir(), 'packed-runtime-gepa-'))
  const concurrentGepaRunDir = await mkdtemp(join(tmpdir(), 'packed-runtime-gepa-concurrent-'))
  const skillOptRunDir = await mkdtemp(join(tmpdir(), 'packed-runtime-skillopt-'))
  const gepaModel = await startModelServer('```\n{"k":2}\n```')
  const concurrentGepaModel = await startModelServer('```\n{"k":2}\n```', 750)
  const skillOptModel = await startModelServer(
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

  try {
    const firstGepa = await runGepa({
      runDir: gepaRunDir,
      modelUrl: gepaModel.baseUrl,
      resume: 'if-compatible',
    })
    assert(firstGepa.provenance?.resumed === false, 'first GEPA run must be fresh')
    assert(firstGepa.provenance?.source.version === '0.1.4', 'GEPA version was not observed')
    assert(
      firstGepa.provenance?.bridge?.version === '0.126.5',
      'agent-eval-rpc version was not observed',
    )
    assert(firstGepa.decision === 'ship', 'GEPA candidate was not promoted')
    assert(
      JSON.parse(String(firstGepa.candidate.value)).k === 2,
      'GEPA did not produce the expected candidate',
    )

    const resumedGepa = await runGepa({
      runDir: gepaRunDir,
      modelUrl: gepaModel.baseUrl,
      resume: 'required',
    })
    assert(resumedGepa.provenance?.resumed === true, 'second GEPA run did not restore state')
    assert(
      resumedGepa.provenance?.compatibleRunId === firstGepa.provenance?.compatibleRunId,
      'resumed GEPA run changed compatible identity',
    )

    let incompatibleError
    try {
      await runGepa({
        runDir: gepaRunDir,
        modelUrl: gepaModel.baseUrl,
        objective: 'Return a different configuration.',
        resume: 'required',
      })
    } catch (error) {
      incompatibleError = error
    }
    assert(incompatibleError instanceof Error, 'incompatible GEPA state was accepted')
    assert(
      /no compatible run|does not exist/i.test(incompatibleError.message),
      `unexpected incompatible-state error: ${incompatibleError.message}`,
    )

    const concurrentResults = await Promise.allSettled([
      runGepa({
        runDir: concurrentGepaRunDir,
        modelUrl: concurrentGepaModel.baseUrl,
        resume: 'if-compatible',
      }),
      runGepa({
        runDir: concurrentGepaRunDir,
        modelUrl: concurrentGepaModel.baseUrl,
        resume: 'if-compatible',
      }),
    ])
    const completedConcurrent = concurrentResults.filter((result) => result.status === 'fulfilled')
    const rejectedConcurrent = concurrentResults.filter((result) => result.status === 'rejected')
    assert(
      completedConcurrent.length === 1 && rejectedConcurrent.length === 1,
      `expected one completed and one rejected concurrent GEPA run, found ${completedConcurrent.length} completed and ${rejectedConcurrent.length} rejected`,
    )
    const completedGepa = completedConcurrent[0].value
    const concurrentError = rejectedConcurrent[0].reason
    assert(concurrentError instanceof Error, 'concurrent GEPA rejection was not an Error')
    assert(
      /GEPA run '[0-9a-f]{64}' is already active/.test(concurrentError.message),
      `concurrent GEPA run was not rejected by the upstream run lock: ${concurrentError.message}`,
    )
    assert(completedGepa.decision === 'ship', 'completed concurrent GEPA run was not promoted')
    assert(
      JSON.parse(String(completedGepa.candidate.value)).k === 2,
      'completed concurrent GEPA run produced the wrong candidate',
    )

    const skillOpt = await runSkillOpt(skillOptRunDir, skillOptModel.baseUrl)
    assert(skillOpt.provenance?.source.package === 'skillopt', 'SkillOpt source was not observed')
    assert(
      skillOpt.provenance?.source.revision ===
        '61735e3922efc2b90c6d6cab561e62e98452ca90',
      'SkillOpt revision was not observed',
    )
    assert(skillOpt.decision === 'ship', 'SkillOpt candidate was not promoted')
    assert(
      String(skillOpt.candidate.value).includes('ALWAYS_RETURN_READY'),
      'SkillOpt did not produce the expected candidate',
    )

    process.stdout.write(
      `${JSON.stringify({
        runtimeImport: '@tangle-network/agent-runtime',
        gepa: {
          bridge: firstGepa.provenance.bridge.version,
          evaluations: firstGepa.provenance.evaluationCount,
          resumed: resumedGepa.provenance.resumed,
          source: firstGepa.provenance.source.version,
          concurrent: {
            completed: completedConcurrent.length,
            rejectedByUpstreamLock: rejectedConcurrent.length,
          },
        },
        skillopt: {
          evaluations: skillOpt.provenance.evaluationCount,
          revision: skillOpt.provenance.source.revision,
        },
      })}\n`,
    )
  } finally {
    await Promise.all([gepaModel.close(), concurrentGepaModel.close(), skillOptModel.close()])
    await Promise.all([
      rm(gepaRunDir, { recursive: true, force: true }),
      rm(concurrentGepaRunDir, { recursive: true, force: true }),
      rm(skillOptRunDir, { recursive: true, force: true }),
    ])
  }
}

async function runOmniVerification() {
  const runDir = await mkdtemp(join(tmpdir(), 'packed-runtime-gepa-omni-'))
  const model = await startModelServer('```\n{"k":2}\n```')
  const profile = {
    name: 'packed-official-gepa-omni',
    prompt: { systemPrompt: '{"k":1}' },
  }

  try {
    const result = await improve(profile, {
      surface: 'prompt',
      executionRef: digest({ fixture: 'packed-official-gepa-omni' }),
      method: officialGepa({
        objective: 'Return a JSON configuration whose k value is 2.',
        recipe: {
          kind: 'omni',
          explore: [gepaEngineRun(11, 4), gepaEngineRun(29, 4)],
          continueWith: gepaEngineRun(47, 4),
          maxWorkers: 1,
        },
        optimizer: optimizerModel(model.baseUrl, 2_000),
        runner: {
          command: python,
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

    assert(result.method === 'gepa:omni:gepa', `unexpected Omni method: ${result.method}`)
    assert(result.provenance?.source.version === '0.1.4', 'source GEPA version was not observed')
    assert(
      result.provenance?.source.revision === 'f919db0a622e2e9f9204779b81fe00cc1b2d808f',
      'source GEPA revision was not observed',
    )
    assert(
      result.provenance?.bridge?.version === '0.126.5',
      'Omni agent-eval-rpc version was not observed',
    )
    assert(result.decision === 'ship', 'Omni candidate was not promoted')
    assert(
      JSON.parse(String(result.candidate.value)).k === 2,
      'Omni did not produce the expected candidate',
    )
    assert(
      Number(result.provenance?.evaluationCount) > 0 &&
        Number(result.provenance?.evaluationCount) <= 12,
      `Omni evaluation count must be between 1 and 12, found ${String(result.provenance?.evaluationCount)}`,
    )
    assert(
      model.requests.length > 0 && model.requests.length <= 3,
      `Omni model requests must be between 1 and 3, found ${model.requests.length}`,
    )

    process.stdout.write(
      `${JSON.stringify({
        runtimeImport: '@tangle-network/agent-runtime',
        omni: {
          bridge: result.provenance.bridge.version,
          continuationEngines: 1,
          evaluations: result.provenance.evaluationCount,
          exploreEngines: 2,
          modelRequests: model.requests.length,
          revision: result.provenance.source.revision,
          source: result.provenance.source.version,
        },
      })}\n`,
    )
  } finally {
    await model.close()
    await rm(runDir, { recursive: true, force: true })
  }
}

function runGepa({
  runDir,
  modelUrl,
  objective = 'Return a JSON configuration whose k value is 2.',
  resume,
}) {
  const profile = {
    name: 'packed-official-gepa',
    prompt: { systemPrompt: '{"k":1}' },
  }
  return improve(profile, {
    surface: 'prompt',
    executionRef: digest({ fixture: 'packed-official-gepa' }),
    method: officialGepa({
      objective,
      recipe: {
        kind: 'engine',
        run: gepaEngineRun(7, 5),
      },
      optimizer: optimizerModel(modelUrl, 2_000),
      resume,
      trustResumeState: true,
      runner: {
        command: python,
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
}

function gepaEngineRun(seed, maxEvaluations) {
  return {
    engine: 'gepa',
    maxEvaluations,
    maxProposerCostUsd: 1,
    maxConcurrency: 1,
    stopAtScore: 1,
    engineConfig: {
      engine: {
        capture_stdio: false,
        max_workers: 1,
        parallel: false,
        raise_on_exception: true,
        seed,
        use_cloudpickle: false,
      },
      reflection: {
        reflection_minibatch_size: 1,
        skip_perfect_score: false,
      },
    },
  }
}

function runSkillOpt(runDir, modelUrl) {
  const profile = {
    name: 'packed-official-skillopt',
    resources: {
      failOnError: true,
      skills: [{ kind: 'inline', name: 'answering', content: '# Answering\nAnswer normally.\n' }],
    },
  }
  return improve(profile, {
    surface: 'skills',
    skills: { resourceName: 'answering' },
    executionRef: digest({ fixture: 'packed-official-skillopt' }),
    method: officialSkillOpt({
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
      optimizer: optimizerModel(modelUrl, 256),
      maxEvaluations: 3,
      runner: { command: python },
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
}

const kEqualsTwoJudge = {
  name: 'k-equals-two',
  dimensions: [{ key: 'correctness', description: 'candidate sets k to 2' }],
  judgeVersion: 'packed-k-equals-two/1',
  score: ({ artifact }) => {
    let score = 0
    try {
      score = JSON.parse(artifact.text).k === 2 ? 1 : 0
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

const requiredRuleJudge = {
  name: 'required-rule',
  dimensions: [{ key: 'correctness', description: 'candidate contains required rule' }],
  judgeVersion: 'packed-required-rule/1',
  score: ({ artifact }) => {
    const score = artifact.text.includes('ALWAYS_RETURN_READY') ? 1 : 0
    return {
      dimensions: { correctness: score },
      composite: score,
      notes: score ? '' : 'The required response rule is absent.',
    }
  },
}

function optimizerModel(baseUrl, maxOutputTokensPerRequest) {
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

function digest(value) {
  const hex = createHash('sha256').update(JSON.stringify(value)).digest('hex')
  return `sha256:${hex}`
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function startModelServer(content, responseDelayMs = 0) {
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (responseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, responseDelayMs))
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: { content, role: 'assistant' },
          },
        ],
        created: 0,
        id: 'chatcmpl-local',
        model: 'local-model',
        object: 'chat.completion',
        usage: {
          completion_tokens: 13,
          prompt_tokens: 11,
          total_tokens: 24,
        },
      }),
    )
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('optimizer model server failed to bind')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

await main()
