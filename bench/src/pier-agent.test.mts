import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { canonicalJson } from '@tangle-network/agent-eval'
import type {
  AgentCandidateExecutorRequest,
  PreparedAgentCandidateExecution,
} from '@tangle-network/agent-runtime'

import {
  awaitAbortableTrial,
  protectedCaptureFromPierResult,
  stagePreparedPierCandidateExecution,
} from './pier-agent'

const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

function prepared(root: string): PreparedAgentCandidateExecution {
  const bundleDigest = `sha256:${'b'.repeat(64)}` as const
  const executionId = 'pier-test-execution'
  const material = {
    schemaVersion: 1,
    kind: 'agent-candidate-execution-plan-material',
    bundleDigest,
    executionId,
    task: {
      outcome: {
        kind: 'workspace',
        repository: {
          identity: 'fixture/repository',
          rootIdentity: 'fixture/repository',
          baseCommit: '1'.repeat(40),
          baseTree: '2'.repeat(40),
        },
      },
    },
    limits: {
      timeoutMs: 60_000,
      maxSteps: 8,
      maxModelCalls: 0,
      maxInputTokens: 0,
      maxOutputTokens: 0,
      maxCostUsd: 0,
    },
  }
  const planBytes = Buffer.from(canonicalJson(material))
  const planDigest = digest(planBytes)
  const receiptMaterial = {
    schemaVersion: 1,
    kind: 'agent-candidate-materialization',
    digestAlgorithm: 'rfc8785-sha256',
    bundleDigest,
    executionPlan: { digest: planDigest, material },
  }
  const receiptBytes = Buffer.from(canonicalJson(receiptMaterial))
  const receiptDigest = digest(receiptBytes)
  const profileBytes = Buffer.from('fixture profile\n')
  return {
    bundle: { digest: bundleDigest },
    executionId,
    roots: {
      execution: { taskRoot: '/app' },
      staging: {
        taskRoot: join(root, 'task'),
        profileRoot: join(root, 'profile'),
      },
    },
    executionPlan: {
      value: { digest: planDigest, material },
      bytes: planBytes,
    },
    profilePlan: {
      value: {
        material: {
          files: [
            {
              relPath: 'AGENTS.md',
              mode: 0o644,
              contentSha256: digest(profileBytes),
            },
          ],
        },
      },
      bytes: Buffer.from('{}'),
      written: ['AGENTS.md'],
    },
    profileActivation: {
      files: [{ path: 'AGENTS.md', mode: 0o644, content: profileBytes.toString('utf8') }],
    },
    materializationReceipt: {
      value: { ...receiptMaterial, digest: receiptDigest },
      bytes: receiptBytes,
      digest: receiptDigest,
    },
    resolvedModel: {
      requested: 'openai/gpt-5.4',
      provider: 'openai',
      model: 'gpt-5.4',
      snapshot: 'gpt-5.4-2026-06-01',
      reasoningEffort: 'xhigh',
    },
    launch: {
      executable: 'python3',
      args: ['/opt/tangle-candidate/runner.py'],
      env: { PUBLIC_MODE: 'fixture' },
      flags: [],
      cwd: '/app',
    },
    memory: { mode: 'disabled' },
    trace: {
      runId: executionId,
      tags: {},
      env: {
        TANGLE_CANDIDATE_EXECUTION_ID: executionId,
        TANGLE_CANDIDATE_BUNDLE_DIGEST: bundleDigest,
        TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST: planDigest,
        TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST: receiptDigest,
        TANGLE_TRACE_RUN_ID: executionId,
      },
    },
  } as unknown as PreparedAgentCandidateExecution
}

function request(execution: PreparedAgentCandidateExecution): AgentCandidateExecutorRequest {
  const taskBytes = Buffer.from('not ready\n')
  const profileBytes = Buffer.from('fixture profile\n')
  return {
    executionId: execution.executionId,
    inputs: {
      task: {
        snapshot: {
          material: {
            files: [
              {
                path: 'src/status.txt',
                mode: 0o644,
                sha256: digest(taskBytes),
                byteLength: taskBytes.byteLength,
              },
            ],
          },
        },
        files: [{ path: 'src/status.txt', mode: 0o644, bytes: taskBytes }],
      },
    },
    roots: execution.roots.execution,
    profilePlan: execution.profilePlan,
    profileActivation: execution.profileActivation,
    executionPlan: execution.executionPlan,
    materializationReceipt: execution.materializationReceipt,
    launch: {
      ...execution.launch,
      env: {
        ...execution.launch.env,
        OPENAI_API_KEY: 'evaluator-only',
        ...execution.trace.env,
      },
    },
    instruction: execution.instruction,
    resolvedModel: execution.resolvedModel,
    hardLimits: { timeoutMs: execution.executionPlan.value.material.limits.timeoutMs },
    observedLimits: { maxSteps: execution.executionPlan.value.material.limits.maxSteps },
    trace: execution.trace,
    memory: execution.memory,
  } as unknown as AgentCandidateExecutorRequest
}

test('stages the runtime exact bytes without defining another execution plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pier-stage-'))
  try {
    const execution = prepared(root)
    const staged = await stagePreparedPierCandidateExecution(
      {
        prepared: execution,
        directory: join(root, 'sealed'),
        pierVersion: '0.3.0',
      },
      request(execution),
    )
    assert.deepEqual(await readFile(staged.planPath), Buffer.from(execution.executionPlan.bytes))
    assert.deepEqual(
      await readFile(staged.receiptPath),
      Buffer.from(execution.materializationReceipt.bytes),
    )
    assert.equal(
      await readFile(join(staged.taskDirectory, 'src/status.txt'), 'utf8'),
      'not ready\n',
    )
    assert.equal(
      await readFile(join(staged.profileDirectory, 'AGENTS.md'), 'utf8'),
      'fixture profile\n',
    )
    assert.deepEqual(staged.evaluatorEnv, {
      ...execution.trace.env,
      OPENAI_API_KEY: 'evaluator-only',
    })
    assert.doesNotMatch(JSON.stringify(execution), /evaluator-only|OPENAI_API_KEY/)
    assert.doesNotMatch(staged.agentArgs.join(' '), /evaluator-only|OPENAI_API_KEY/)
    assert.deepEqual(staged.attemptArgs, ['--n-attempts', '1', '--max-retries', '0'])
    assert.ok(staged.agentArgs.includes('pier_agents.tangle_candidate:TangleCandidateAgent'))
    assert.ok(staged.agentArgs.includes('openai/gpt-5.4'))
    assert.ok(
      staged.agentArgs.includes(
        `expected_receipt_digest=${execution.materializationReceipt.digest}`,
      ),
    )
    assert.ok(staged.agentArgs.includes(`task_dir=${staged.taskDirectory}`))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reads only identity and termination from Pier, never candidate-authored usage', () => {
  const root = '/tmp/pier-capture-test'
  const execution = prepared(root)
  const metadata = {
    executionId: execution.executionId,
    bundleDigest: execution.bundle.digest,
    executionPlanDigest: execution.executionPlan.value.digest,
    materializationReceiptDigest: execution.materializationReceipt.digest,
    termination: { kind: 'exit', exitCode: 0 },
  }
  const capture = protectedCaptureFromPierResult(request(execution), {
    exception_info: null,
    agent_result: {
      n_input_tokens: 999_999,
      cost_usd: 999_999,
      metadata,
    },
  })
  assert.deepEqual(capture, {
    executionId: execution.executionId,
    termination: { kind: 'exit', exitCode: 0 },
  })
  assert.deepEqual(
    protectedCaptureFromPierResult(request(execution), {
      exception_info: { exception_type: 'AgentTimeoutError' },
      agent_result: { metadata: { ...metadata, termination: { kind: 'cancelled' } } },
    }),
    {
      executionId: execution.executionId,
      termination: { kind: 'timeout', timeoutMs: 60_000 },
    },
  )
})

test('rejects substituted canonical bytes before writing Pier artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pier-stage-tamper-'))
  try {
    const execution = prepared(root)
    const tampered = {
      ...execution,
      executionPlan: { ...execution.executionPlan, bytes: Buffer.from('{}') },
    } as PreparedAgentCandidateExecution
    await assert.rejects(
      stagePreparedPierCandidateExecution(
        {
          prepared: tampered,
          directory: join(root, 'sealed'),
          pierVersion: '0.3.0',
        },
        request(tampered),
      ),
      /do not match/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects an executor request that changes signed public environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pier-stage-env-'))
  try {
    const execution = prepared(root)
    const changed = request(execution)
    ;(changed.launch as { env: Record<string, string> }).env.PUBLIC_MODE = 'changed'
    await assert.rejects(
      stagePreparedPierCandidateExecution(
        {
          prepared: execution,
          directory: join(root, 'sealed'),
          pierVersion: '0.3.0',
        },
        changed,
      ),
      /changed signed public environment/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects changed or escaping executor files before launch', async () => {
  for (const attack of ['bytes', 'path'] as const) {
    const root = await mkdtemp(join(tmpdir(), `pier-stage-${attack}-`))
    try {
      const execution = prepared(root)
      const changed = request(execution)
      const file = changed.inputs.task.files[0] as { path: string; bytes: Uint8Array }
      if (attack === 'bytes') file.bytes = Buffer.from('changed\n')
      else file.path = '../escape'
      await assert.rejects(
        stagePreparedPierCandidateExecution(
          {
            prepared: execution,
            directory: join(root, 'sealed'),
            pierVersion: '0.3.0',
          },
          changed,
        ),
        attack === 'bytes' ? /differs from signed evidence/ : /canonical relative POSIX path/,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('waits for process and container death acknowledgement after abort', async () => {
  const controller = new AbortController()
  let terminated = false
  const waiting = awaitAbortableTrial(
    {
      identity: {
        executionId: 'abort-test',
        executionPlanDigest: `sha256:${'a'.repeat(64)}`,
      },
      result: new Promise(() => undefined),
      terminateAndWait: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        terminated = true
        return { processExited: true, containersRemoved: true }
      },
    },
    controller.signal,
  )
  controller.abort(new Error('signed deadline elapsed'))
  await assert.rejects(waiting, /signed deadline elapsed/)
  assert.equal(terminated, true)
})

test('fails closed when termination does not acknowledge container removal', async () => {
  const controller = new AbortController()
  const waiting = awaitAbortableTrial(
    {
      identity: {
        executionId: 'bad-ack-test',
        executionPlanDigest: `sha256:${'b'.repeat(64)}`,
      },
      result: new Promise(() => undefined),
      terminateAndWait: async () => ({ processExited: true, containersRemoved: false }) as never,
    },
    controller.signal,
  )
  controller.abort()
  await assert.rejects(waiting, /did not acknowledge/)
})
