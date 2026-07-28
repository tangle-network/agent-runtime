import type { ChatClient } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'

import { observe } from '../src/runtime/observe'

describe('runtime observe', () => {
  it('marks observed production behavior as proposal input from production', async () => {
    const chat: ChatClient = {
      transport: 'mock',
      chat: async () => ({
        content: JSON.stringify({
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
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        costUsd: 0,
        model: 'observer-test',
        durationMs: 1,
        raw: {},
      }),
    }

    const result = await observe(
      {
        task: 'Change the code and run the focused test.',
        output: 'Changed the code.',
        trace: [{ type: 'status', data: { status: 'completed' } }],
        runId: 'production-run-1',
      },
      { chat },
    )

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      analyst_id: 'observe/trace',
      derived_from_judge: false,
      proposal_origin: 'production',
      subject: 'production-run-1',
    })
  })
})
