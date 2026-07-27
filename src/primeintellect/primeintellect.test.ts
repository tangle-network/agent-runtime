import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPrimeIntellectPackage, writePrimeIntellectPackage } from './package'
import {
  createPrimeIntellectBackend,
  readPrimeIntellectEpisodeContext,
  runPrimeIntellectProgram,
} from './runner'
import {
  importPrimeIntellectTraces,
  type PrimeIntellectTrace,
  parsePrimeIntellectTraces,
  primeIntellectTraceToRunRecord,
} from './traces'
import type { PrimeIntellectPackageOptions } from './types'

function packageOptions(): PrimeIntellectPackageOptions {
  return {
    name: 'support-agent',
    version: '1.0.0',
    tasks: [
      {
        id: 'train-refund',
        split: 'train',
        prompt: 'Can this order be refunded?',
        answer: 'No',
        metadata: { policy: 'refunds' },
      },
      {
        id: 'eval-refund',
        split: 'eval',
        prompt: 'Is a final-sale order refundable?',
        answer: 'No',
      },
    ],
    scoring: { kind: 'exact', normalization: 'trim-casefold' },
    runner: {
      image: 'node:22-bookworm-slim',
      files: { 'runner.mjs': 'console.log("runner")\n' },
      command: ['node', 'runner.mjs'],
    },
  }
}

describe('PrimeIntellect package', () => {
  it('builds a split-safe package around the caller runtime program', () => {
    const bundle = createPrimeIntellectPackage(packageOptions())

    expect(bundle.manifest.splits).toEqual({ train: 1, eval: 1 })
    expect(bundle.manifest.kind).toBe('tangle.primeintellect.package')
    expect(bundle.manifest.verifiers).toBe('>=0.2.0,<0.3.0')
    expect(bundle.files['prime.eval.toml']).toContain('max_turns = 16')
    expect(bundle.files['prime.eval.toml']).toContain('type = "docker"')
    expect(bundle.files['support_agent/taskset.py']).toContain('import verifiers.v1 as vf')
    expect(bundle.files['support_agent/harness.py']).toContain('runtime.run_program')
    expect(bundle.files['support_agent/harness.py']).not.toContain('data.answer')
    expect(bundle.files['support_agent/harness.py']).not.toContain('reference')
  })

  it('requires both splits and rejects duplicate ids and unsafe runner files', () => {
    const options = packageOptions()
    expect(() =>
      createPrimeIntellectPackage({ ...options, tasks: options.tasks.slice(0, 1) }),
    ).toThrow(/non-empty, disjoint train and eval splits/)
    expect(() =>
      createPrimeIntellectPackage({
        ...options,
        tasks: [options.tasks[0]!, { ...options.tasks[1]!, id: options.tasks[0]!.id }],
      }),
    ).toThrow(/duplicate PrimeIntellect task id/)
    expect(() =>
      createPrimeIntellectPackage({
        ...options,
        runner: { ...options.runner, files: { '../answer.txt': 'secret' } },
      }),
    ).toThrow(/unsafe path/)
    expect(() =>
      createPrimeIntellectPackage({
        ...options,
        tasks: [options.tasks[0]!, { ...options.tasks[0]!, id: 'eval-copy', split: 'eval' }],
      }),
    ).toThrow(/expose the same public input/)
  })

  it('rejects malformed messages and duplicate system prompts', () => {
    const options = packageOptions()
    expect(() =>
      createPrimeIntellectPackage({
        ...options,
        tasks: [{ ...options.tasks[0]!, prompt: [{ role: 'user' }] as never }, options.tasks[1]!],
      }),
    ).toThrow(/content/)
    expect(() =>
      createPrimeIntellectPackage({
        ...options,
        tasks: [
          {
            ...options.tasks[0]!,
            systemPrompt: 'First system prompt',
            prompt: [{ role: 'system', content: 'Second system prompt' }],
          },
          options.tasks[1]!,
        ],
      }),
    ).toThrow(/must not set systemPrompt and include a system message/)
    expect(() =>
      createPrimeIntellectPackage({
        ...options,
        tasks: [
          {
            ...options.tasks[0]!,
            prompt: [{ role: 'assistant', content: null, unsupported: true }] as never,
          },
          options.tasks[1]!,
        ],
      }),
    ).toThrow(/unsupported is not supported/)
    expect(() =>
      createPrimeIntellectPackage({
        ...options,
        tasks: [
          {
            ...options.tasks[0]!,
            prompt: [
              {
                role: 'assistant',
                content: null,
                provider_state: [{ signature: 'opaque-provider-state' }],
              },
            ],
          },
          options.tasks[1]!,
        ],
      }),
    ).not.toThrow()
  })

  it('writes atomically and refuses an existing destination by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'prime-package-test-'))
    const output = join(root, 'generated')
    try {
      const bundle = createPrimeIntellectPackage(packageOptions())
      await writePrimeIntellectPackage(bundle, output)
      expect(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))).toEqual(
        bundle.manifest,
      )
      await expect(writePrimeIntellectPackage(bundle, output)).rejects.toThrow(/already exists/)
      await expect(writePrimeIntellectPackage(bundle, output, { replace: true })).resolves.toBe(
        output,
      )

      const unrelated = join(root, 'user-owned')
      await mkdir(unrelated)
      await writeFile(join(unrelated, 'important.txt'), 'keep me', 'utf8')
      await expect(
        writePrimeIntellectPackage(bundle, unrelated, { replace: true }),
      ).rejects.toThrow(/not a generated PrimeIntellect package/)
      await expect(readFile(join(unrelated, 'important.txt'), 'utf8')).resolves.toBe('keep me')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('PrimeIntellect runtime program contract', () => {
  const env = {
    TANGLE_PRIME_TASK_JSON: JSON.stringify({
      id: 'eval-refund',
      split: 'eval',
      prompt: 'Is this refundable?',
      systemPrompt: 'Use the policy tools.',
      metadata: { tenant: 'test' },
    }),
    TANGLE_PRIME_MCP_SERVERS_JSON: JSON.stringify({ policy: 'http://127.0.0.1:3210/mcp' }),
    OPENAI_MODEL: 'openai/gpt-5.4-20260601',
    OPENAI_BASE_URL: 'http://127.0.0.1:9000/v1',
    OPENAI_API_KEY: 'interception-secret',
  }

  it('reads an answer-free episode and creates the existing backend', async () => {
    const context = readPrimeIntellectEpisodeContext(env)
    expect(context.task.id).toBe('eval-refund')
    expect(context.mcpServers.policy).toBe('http://127.0.0.1:3210/mcp')
    expect(createPrimeIntellectBackend(context).kind).toBe('primeintellect')
    expect(createPrimeIntellectBackend(context, { kind: 'product-runtime' }).kind).toBe(
      'product-runtime',
    )
    await expect(
      runPrimeIntellectProgram(async (episode) => episode.task.id, { env }),
    ).resolves.toBe('eval-refund')
  })

  it('fails if the task process exposes a private scoring field', () => {
    expect(() =>
      readPrimeIntellectEpisodeContext({
        ...env,
        TANGLE_PRIME_TASK_JSON: JSON.stringify({
          id: 'leaked',
          split: 'eval',
          prompt: 'Question',
          answer: 'private',
        }),
      }),
    ).toThrow(/exposed private field answer/)
  })

  it('rejects conflicting system prompts and malformed tool calls', () => {
    expect(() =>
      readPrimeIntellectEpisodeContext({
        ...env,
        TANGLE_PRIME_TASK_JSON: JSON.stringify({
          id: 'conflicting-system',
          split: 'eval',
          prompt: [{ role: 'system', content: 'In prompt' }],
          systemPrompt: 'Alongside prompt',
        }),
      }),
    ).toThrow(/must not set systemPrompt and include a system message/)
    expect(() =>
      readPrimeIntellectEpisodeContext({
        ...env,
        TANGLE_PRIME_TASK_JSON: JSON.stringify({
          id: 'bad-tool-call',
          split: 'eval',
          prompt: [{ role: 'assistant', tool_calls: [{ id: 'call-1', name: 'search' }] }],
        }),
      }),
    ).toThrow(/arguments/)
  })
})

function primeTrace(): PrimeIntellectTrace {
  return {
    id: 'prime-trace-1',
    task: {
      type: 'TangleTask',
      data: { idx: 1, name: 'eval-refund', split: 'eval', prompt: 'Question' },
    },
    nodes: [
      {
        parent: null,
        sampled: false,
        usage: null,
      },
      {
        parent: 0,
        sampled: true,
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          cached_input_tokens: 40,
          reasoning_tokens: 5,
          cost: 0.03,
        },
      },
      {
        parent: 1,
        sampled: true,
        usage: {
          prompt_tokens: 50,
          completion_tokens: 10,
          cost: 0.02,
        },
      },
    ],
    rewards: { task_reward: 0.8 },
    metrics: { citation_precision: 0.75 },
    extra_usage: [{ prompt_tokens: 10, completion_tokens: 2, reasoning_tokens: 1, cost: 0.01 }],
    is_completed: true,
    stop_condition: 'agent_completed',
    errors: [],
    timing: {
      start: 100,
      generation: { start: 101, end: 104 },
      scoring: { start: 104, end: 105.5 },
    },
  }
}

const importOptions = {
  experimentId: 'prime-eval-1',
  candidateId: 'support-agent-a',
  seed: 42,
  model: 'openai/gpt-5.4-20260601',
  promptHash: 'a'.repeat(64),
  configHash: 'b'.repeat(64),
  commitSha: 'c'.repeat(40),
}

describe('PrimeIntellect trace import', () => {
  it('preserves score, metrics, turns, tokens, cost, duration, scenario, and split', () => {
    const record = primeIntellectTraceToRunRecord(primeTrace(), importOptions)

    expect(record.splitTag).toBe('holdout')
    expect(record.scenarioId).toBe('eval-refund')
    expect(record.outcome.holdoutScore).toBe(0.8)
    expect(record.outcome.raw).toMatchObject({
      reward: 0.8,
      'prime.turns': 2,
      'prime.branches': 1,
      'metric.citation_precision': 0.75,
    })
    expect(record.tokenUsage).toEqual({ input: 200, output: 32, reasoning: 6, cached: 40 })
    expect(record.costUsd).toBeCloseTo(0.06)
    expect(record.costProvenance?.kind).toBe('observed')
    expect(record.costProvenance?.usd).toBeCloseTo(0.06)
    expect(record.terminalOutcome).toBe('succeeded')
    expect(record.wallMs).toBe(5_500)
  })

  it('parses durable JSONL and refuses empty or malformed inputs', () => {
    const jsonl = `${JSON.stringify(primeTrace())}\n`
    expect(parsePrimeIntellectTraces(jsonl)).toHaveLength(1)
    expect(importPrimeIntellectTraces(jsonl, importOptions)).toHaveLength(1)
    expect(() => parsePrimeIntellectTraces('\n')).toThrow(/contains no traces/)
    expect(() => parsePrimeIntellectTraces('{oops}\n')).toThrow(/line 1 is invalid JSON/)
  })

  it('marks partial cost as uncaptured while retaining the reported subtotal', () => {
    const trace = primeTrace()
    delete trace.nodes[2]!.usage!.cost
    const record = primeIntellectTraceToRunRecord(trace, importOptions)

    expect(record.costUsd).toBeNull()
    expect(record.costProvenance).toEqual({ kind: 'uncaptured', usd: null })
    expect(record.terminalOutcome).toBe('succeeded')
    expect(record.outcome.raw).toMatchObject({
      'prime.cost_complete': 0,
      'prime.reported_cost_usd': 0.04,
    })
  })

  it('keeps root completion separate from task scores', () => {
    const incomplete = primeIntellectTraceToRunRecord(
      { ...primeTrace(), is_completed: false },
      importOptions,
    )
    expect(incomplete.terminalOutcome).toBe('incomplete')

    const failed = primeIntellectTraceToRunRecord(
      {
        ...primeTrace(),
        errors: [{ type: 'worker', message: 'process exited 1' }],
      },
      importOptions,
    )
    expect(failed.terminalOutcome).toBe('failed')
    expect(failed.terminalFailureReason).toBe('worker:process exited 1')
  })

  it('rejects malformed graph nodes and usage instead of undercounting them', () => {
    expect(() =>
      parsePrimeIntellectTraces(`${JSON.stringify({ ...primeTrace(), nodes: [null] })}\n`),
    ).toThrow(/nodes\[0\] must be an object/)
    expect(() =>
      parsePrimeIntellectTraces(
        `${JSON.stringify({
          ...primeTrace(),
          nodes: [{ parent: 1, sampled: true, usage: null }],
        })}\n`,
      ),
    ).toThrow(/parent must reference an earlier node/)
    expect(() =>
      parsePrimeIntellectTraces(
        `${JSON.stringify({
          ...primeTrace(),
          nodes: [
            {
              parent: null,
              sampled: true,
              usage: { prompt_tokens: -1, completion_tokens: 0 },
            },
          ],
        })}\n`,
      ),
    ).toThrow(/prompt_tokens must be non-negative/)
    expect(() =>
      parsePrimeIntellectTraces(
        `${JSON.stringify({ ...primeTrace(), errors: [{ type: 'timeout' }] })}\n`,
      ),
    ).toThrow(/message must be a non-empty string/)
    expect(() =>
      parsePrimeIntellectTraces(
        `${JSON.stringify({ ...primeTrace(), timing: { start: 'now' } })}\n`,
      ),
    ).toThrow(/timing.start must be a finite number/)
  })
})
