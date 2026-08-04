import { describe, expect, it } from 'vitest'

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
    ).rejects.toThrow(/observe findings: every finding must match AnalystFinding/)
  })
})
