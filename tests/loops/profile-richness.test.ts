import { describe, expect, it } from 'vitest'
import { assessAuthoredProfile, profileRichnessFinding } from '../../src/runtime/index'
import { toToolSpan } from '../../src/runtime/supervise/trace-source'

type Profile = Parameters<typeof assessAuthoredProfile>[0]
const profile = (over: Record<string, unknown>): Profile =>
  ({ name: 'w', prompt: { systemPrompt: '' }, ...over }) as unknown as Profile

const richPrompt = [
  'You implement is_palindrome(s: str) -> bool in src/utils.py, and nothing else.',
  'Follow the contract in tests/test_utils.py exactly — read it first, do not change the tests.',
  'Handle every edge case the tests check: the empty string returns True, casing is normalized to lower, and all non-alphanumeric characters are ignored before comparison.',
  'Workflow: use read to inspect src/utils.py and the tests, use write to edit only src/utils.py, then use run_python to execute `pytest -q` and read the output.',
  'Definition of done: the full pytest suite passes with zero failures and zero errors.',
  'Do not touch any file other than src/utils.py; do not install packages.',
  'If a test fails, read the assertion, fix the implementation, and re-run — never edit the test to make it pass.',
  'Report the final pytest output verbatim before you stop.',
].join('\n')

describe('assessAuthoredProfile (profile-richness gate)', () => {
  it('scores a complete profile RICH (deep prompt + tools + skills + description)', () => {
    const r = assessAuthoredProfile(
      profile({
        name: 'rich',
        description: 'Implements is_palindrome until the suite passes.',
        prompt: { systemPrompt: richPrompt },
        tools: { read: true, write: true, bash: true },
        resources: { skills: ['python-tdd', 'edge-case-coverage'] },
      }),
    )
    expect(r.thin).toBe(false)
    expect(r.hasTools).toBe(true)
    expect(r.hasSkills).toBe(true)
    expect(r.systemPromptLines).toBeGreaterThanOrEqual(6)
    expect(r.richness).toBeGreaterThan(0.8)
    expect(r.reasons).toHaveLength(0)
  })

  it('flags a 2-sentence stub with no levers as THIN, with reasons', () => {
    const r = assessAuthoredProfile(
      profile({ name: 'stub', prompt: { systemPrompt: 'Do the task. Make it good.' } }),
    )
    expect(r.thin).toBe(true)
    expect(r.hasTools).toBe(false)
    expect(r.hasSkills).toBe(false)
    expect(r.reasons.length).toBeGreaterThan(0)
  })

  it('honors a threshold override (medium prompt: thin under default, rich under a low bar)', () => {
    const medium = ['Implement the function.', 'Run the tests.', 'Report the result.'].join('\n')
    const p = profile({
      name: 'med',
      description: 'x',
      prompt: { systemPrompt: medium },
      tools: { read: true },
      resources: { skills: ['x'] },
    })
    expect(assessAuthoredProfile(p).thin).toBe(true)
    expect(
      assessAuthoredProfile(p, {
        thresholds: { minSystemPromptChars: 10, minSystemPromptLines: 2 },
      }).thin,
    ).toBe(false)
  })

  it('counts a missing MCP only when the task needs it', () => {
    const p = profile({
      name: 'm',
      description: 'x',
      prompt: { systemPrompt: richPrompt },
      tools: { read: true },
      resources: { skills: ['x'] },
    })
    expect(assessAuthoredProfile(p).reasons.join(' ')).not.toMatch(/MCP/)
    expect(assessAuthoredProfile(p, { needsMcp: true }).reasons.join(' ')).toMatch(/MCP/)
  })
})

describe('profileRichnessFinding (rides the coordination bus)', () => {
  it('emits a profile-quality AnalystFinding flagging a thin worker (severity >= medium)', () => {
    const r = assessAuthoredProfile(profile({ name: 'stub', prompt: { systemPrompt: 'Do it.' } }))
    const f = profileRichnessFinding(r)
    expect(f.area).toBe('profile-quality')
    expect(f.analyst_id).toBe('profile-richness')
    expect(['medium', 'high']).toContain(f.severity)
    expect(f.claim).toMatch(/THIN/)
    expect(f.finding_id).toBeTruthy()
    expect(f.recommended_action).toBeTruthy()
  })

  it('emits an info finding for a rich worker', () => {
    const r = assessAuthoredProfile(
      profile({
        name: 'rich',
        description: 'x',
        prompt: { systemPrompt: richPrompt },
        tools: { read: true },
        resources: { skills: ['x'] },
      }),
    )
    expect(profileRichnessFinding(r).severity).toBe('info')
  })
})

describe('toToolSpan — the onToolStep -> timeline through-path', () => {
  it('produces a real duration when the step carries startedAt/endedAt', () => {
    const span = toToolSpan(
      { toolName: 'run_python', args: {}, status: 'ok', startedAt: 1000, endedAt: 1250 },
      'run',
      0,
      1000,
    )
    expect(span.startedAt).toBe(1000)
    expect(span.endedAt).toBe(1250)
  })

  it('collapses to the instant when timing is omitted (backward-compatible)', () => {
    const span = toToolSpan({ toolName: 'run_python', args: {}, status: 'ok' }, 'run', 1, 2000)
    expect(span.startedAt).toBe(2000)
    expect(span.endedAt).toBe(2000)
  })
})
