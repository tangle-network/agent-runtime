import { describe, expect, it } from 'vitest'

import { harvestCorpus } from '../src/runtime/harvest-corpus'
import { observe } from '../src/runtime/observe'

const observerProfile = {
  name: 'test-observer',
  harness: 'cli-base' as const,
  model: { provider: 'offline', default: 'observer-test' },
}

function observerExecutor(content: string) {
  return {
    backend: 'router' as const,
    routerBaseUrl: 'http://offline.invalid/v1',
    routerKey: 'offline-test',
    complete: async () => ({
      model: 'observer-test',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
    }),
  }
}

describe('runtime observe', () => {
  it('marks observed production behavior as proposal input from production', async () => {
    const content = JSON.stringify({
      findings: [
        {
          area: 'verification',
          severity: 'high',
          claim: 'The worker returned before running the requested check.',
          recommended_action: 'Run the requested check before returning.',
          audience: 'agent',
          confidence: 0.9,
        },
      ],
    })

    const result = await observe(
      {
        task: 'Change the code and run the focused test.',
        output: 'Changed the code.',
        trace: [{ type: 'status', data: { status: 'completed' } }],
        runId: 'production-run-1',
      },
      { profile: observerProfile, executor: observerExecutor(content) },
    )

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      analyst_id: 'observe/trace',
      derived_from_judge: false,
      proposal_origin: 'production',
      subject: 'production-run-1',
    })
  })

  it('rejects malformed model findings before returning them to callers', async () => {
    const content = JSON.stringify({
      findings: [
        {
          area: 'verification',
          severity: 'urgent',
          claim: 'The worker skipped the requested check.',
          recommended_action: 'Run the requested check.',
          audience: 'agent',
          confidence: 0.9,
        },
      ],
    })

    await expect(
      observe(
        {
          task: 'Change the code and run the focused test.',
          output: 'Changed the code.',
          trace: [{ type: 'status', data: { status: 'completed' } }],
        },
        { profile: observerProfile, executor: observerExecutor(content) },
      ),
    ).rejects.toThrow(/observe response: findings\[0\] does not match/)
  })

  it.each([
    'provider refused the request',
    'null',
    '[]',
    '{}',
    '{"findings":null}',
    '{"findings":[],"error":"provider unavailable"}',
    '{"findings":[null]}',
  ])('rejects an invalid observer response: %s', async (content) => {
    await expect(
      observe(
        { task: 'Inspect the run.', output: 'done', trace: [] },
        { profile: observerProfile, executor: observerExecutor(content) },
      ),
    ).rejects.toThrow(/observe response:/)
  })

  it('accepts an explicit empty findings array', async () => {
    const result = await observe(
      { task: 'Inspect the run.', output: 'done', trace: [] },
      { profile: observerProfile, executor: observerExecutor('{"findings":[]}') },
    )
    expect(result.findings).toEqual([])
    expect(result.report).toContain('clean run')
  })

  it('reports failed corpus persistence through the harvest per-run failure channel', async () => {
    const content = JSON.stringify({
      findings: [
        {
          area: 'verification',
          severity: 'high',
          claim: 'A check was skipped.',
          recommended_action: 'Run the check.',
          audience: 'agent',
          confidence: 0.9,
        },
      ],
    })
    const report = await harvestCorpus({
      runs: [
        { task: 'Inspect the run.', output: 'done', trace: [], runId: 'failed-save' },
        { task: 'Inspect the run.', output: 'done', trace: [], runId: 'saved' },
      ],
      profile: observerProfile,
      executor: observerExecutor(content),
      corpus: {
        append: async (record) =>
          record.runId === 'failed-save'
            ? { succeeded: false, error: 'storage unavailable' }
            : { succeeded: true },
        query: async () => [],
      },
    })
    expect(report).toMatchObject({
      runsObserved: 1,
      findings: 1,
      learned: 1,
      failures: [{ runId: 'failed-save', error: expect.stringContaining('storage unavailable') }],
    })
  })
})
