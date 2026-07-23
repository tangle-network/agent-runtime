/**
 * Hand-built fixture rollout line for exporter/ledger tests — a miniature but
 * fully-valid `tangle.rollout.v1` worker invocation with a real prompt →
 * assistant → tool → assistant transcript.
 */

import type { RolloutLine } from './types.ts'

export function fixtureRolloutLine(overrides: Partial<RolloutLine> = {}): RolloutLine {
  return {
    schema: 'tangle.rollout.v1',
    rollout_id: '11111111-2222-4333-8444-555555555555',
    parent_rollout_id: '99999999-8888-4777-8666-555555555555',
    run_id: '/tmp/run#123',
    generation: 0,
    candidate_index: 1,
    role: 'worker',
    task: {
      suite: 'swe-bench-verified',
      instance_id: 'astropy__astropy-13033',
      split: 'train',
      seed: 42,
      rep: 0,
    },
    policy: {
      harness: 'opencode',
      harness_version: '1.0.0',
      model: 'glm-5.2',
      provider: 'tangle-router',
      profile_commit: '1deb554c45d31dd0d4a851efe90da875cd9b50c8',
      sampling: { temperature: 0 },
    },
    messages: [
      { role: 'system', content: 'You are a coding worker.' },
      { role: 'user', content: 'Fix the misleading exception in TimeSeries.' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'I should read the core module first.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read', arguments: '{"filePath":"astropy/timeseries/core.py"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', name: 'read', content: 'class BaseTimeSeries: ...' },
      { role: 'assistant', content: 'Patched the exception message.' },
    ],
    tool_defs: [
      {
        type: 'function',
        function: { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
      },
    ],
    outcome: {
      reward: 1,
      reward_source: 'swe-arena-official-judge/inherited',
      verdict: { iid: 'astropy__astropy-13033', resolved: true },
      metrics: { verify_pass: true, patch_lines: 12 },
      is_completed: true,
      is_truncated: false,
      error: null,
    },
    cost: {
      usd: 0.05,
      tokens_in: 79554,
      tokens_out: 19784,
      tokens_reasoning: 1200,
      cache_read: 6784,
      cache_write: 0,
      wall_s: 549,
    },
    artifacts: {
      patch_path: '/tmp/run/patches/astropy.patch',
      run_dir: '/tmp/run/runs/astropy__astropy-13033/R4',
      transcript_ref: 'opencode:ses_fixture',
    },
    provenance: {
      captured_at: '2026-07-23T00:00:00.000Z',
      capture: 'backfill',
    },
    ...overrides,
  }
}
