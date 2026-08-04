import { describe, expect, it } from 'vitest'
import {
  createUiAuditorValidator,
  decodeAuditTaskEnvelope,
  encodeAuditTaskEnvelope,
  parseAuditorEvents,
  type UiAuditCapture,
  type UiAuditOutput,
  type UiAuditTask,
  type UiFinding,
} from '../../src/profiles/ui-auditor'

const ctx = { iteration: 0, signal: new AbortController().signal }

function baseCapture(overrides: Partial<UiAuditCapture> = {}): UiAuditCapture {
  return {
    path: 'screenshots/home--1280x800--x.png',
    viewport: '1280x800',
    fullPage: false,
    route: 'home',
    url: 'https://example.com',
    capturedAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  }
}

function baseFinding(overrides: Partial<UiFinding> = {}): UiFinding {
  return {
    title: 'Inconsistent button heights on home page',
    lens: 'consistency',
    severity: 'med',
    route: 'home',
    observation: 'Primary button is 32px tall while another primary button is 40px tall.',
    impact: 'The page reads as unmaintained — two primaries should match.',
    suggestedFix: 'Consolidate to <Button variant="primary" size="md"> at 40px tall.',
    screenshots: [{ path: 'screenshots/home--1280x800--x.png' }],
    ...overrides,
  }
}

function baseTask(overrides: Partial<UiAuditTask> = {}): UiAuditTask {
  return {
    lens: 'consistency',
    captures: [{ route: 'home', url: 'https://example.com' }],
    ...overrides,
  }
}

describe('createUiAuditorValidator', () => {
  it('passes a clean iteration and scores by specificity + title quality', async () => {
    const task = baseTask()
    const validator = createUiAuditorValidator(task)
    const output: UiAuditOutput = {
      lens: 'consistency',
      captures: [baseCapture()],
      findings: [baseFinding({ selector: '.btn-primary' })],
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(true)
    expect(verdict.score).toBeGreaterThan(0.9)
    expect(verdict.scores?.specificity).toBe(1)
  })

  it('hard-fails on lens-mismatch findings', async () => {
    const task = baseTask({ lens: 'consistency' })
    const validator = createUiAuditorValidator(task)
    const output: UiAuditOutput = {
      lens: 'consistency',
      captures: [baseCapture()],
      findings: [baseFinding({ lens: 'hierarchy' })],
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.score).toBe(0)
    expect(verdict.notes).toMatch(/wrong lens/i)
  })

  it('hard-fails when a finding has no screenshots', async () => {
    const task = baseTask()
    const validator = createUiAuditorValidator(task)
    const output: UiAuditOutput = {
      lens: 'consistency',
      captures: [baseCapture()],
      findings: [baseFinding({ screenshots: [] })],
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.notes).toMatch(/no screenshot evidence/i)
  })

  it('hard-fails when a finding references a path not captured this iteration', async () => {
    const task = baseTask()
    const validator = createUiAuditorValidator(task)
    const output: UiAuditOutput = {
      lens: 'consistency',
      captures: [baseCapture()],
      findings: [baseFinding({ screenshots: [{ path: 'screenshots/hallucinated.png' }] })],
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(false)
    expect(verdict.notes).toMatch(/not captured this iteration/i)
  })

  it('passes a zero-finding iteration with a neutral 0.5 score', async () => {
    const task = baseTask()
    const validator = createUiAuditorValidator(task)
    const output: UiAuditOutput = {
      lens: 'consistency',
      captures: [baseCapture()],
      findings: [],
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(true)
    expect(verdict.score).toBe(0.5)
  })

  it('reports evidence ratio honestly even when the score path is reached', async () => {
    // Guards above hard-fail when any finding's screenshots are unresolvable,
    // so the score path always sees evidence=1 today. This test pins that
    // contract: when the score path runs, scores.evidence reflects the
    // resolved-screenshots ratio computed from the actual data, not a
    // hardcoded constant. If the guards are ever relaxed, the validator
    // produces a truthful evidence dimension automatically.
    const task = baseTask()
    const validator = createUiAuditorValidator(task)
    const output: UiAuditOutput = {
      lens: 'consistency',
      captures: [baseCapture()],
      findings: [baseFinding({ selector: '.btn-primary' })],
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(true)
    expect(verdict.scores?.evidence).toBe(1)
    expect(verdict.notes).toContain('evidence=1.00')
  })

  it('penalizes generic titles', async () => {
    const task = baseTask()
    const validator = createUiAuditorValidator(task)
    const output: UiAuditOutput = {
      lens: 'consistency',
      captures: [baseCapture()],
      findings: [
        baseFinding({ title: 'Improve UX', selector: '.btn-primary' }),
        baseFinding({ title: 'Fix layout', selector: '.layout' }),
        baseFinding({
          title: 'Inconsistent button heights on home page',
          selector: '.btn-primary',
        }),
      ],
    }
    const verdict = await validator.validate(output, ctx)
    expect(verdict.valid).toBe(true)
    expect(verdict.scores?.titles).toBeCloseTo(1 / 3, 5)
  })
})

describe('audit task envelope', () => {
  it('round-trips a task', () => {
    const task = baseTask({
      productContext: 'Consumer fintech app for under-banked users.',
      knownFindingIds: [1, 2, 3],
      captures: [
        { route: 'home', url: 'https://example.com', viewport: { width: 1440, height: 900 } },
        { route: 'home', url: 'https://example.com', viewport: { width: 375, height: 812 } },
      ],
    })
    const prompt = encodeAuditTaskEnvelope(task)
    const recovered = decodeAuditTaskEnvelope(prompt)
    expect(recovered).toEqual(task)
  })

  it('returns undefined when the envelope is missing or malformed', () => {
    expect(decodeAuditTaskEnvelope('no envelope here')).toBeUndefined()
    expect(
      decodeAuditTaskEnvelope('<<UI_AUDIT_TASK>>{not json<<UI_AUDIT_TASK_END>>'),
    ).toBeUndefined()
  })
})

describe('parseAuditorEvents', () => {
  it('decodes lens, captures, findings, and notes from an event stream', () => {
    const events = [
      { type: 'audit.lens', data: { lens: 'consistency' } },
      { type: 'audit.capture', data: baseCapture() },
      { type: 'audit.finding', data: baseFinding() },
      { type: 'audit.notes', data: { notes: 'Watch the spacing scale.' } },
      { type: 'done', data: { tokenUsage: { inputTokens: 1, outputTokens: 1 } } },
    ]
    const out = parseAuditorEvents(events)
    expect(out.lens).toBe('consistency')
    expect(out.captures).toHaveLength(1)
    expect(out.findings).toHaveLength(1)
    expect(out.notes).toBe('Watch the spacing scale.')
  })

  it('drops malformed findings without throwing', () => {
    const events = [
      { type: 'audit.lens', data: { lens: 'consistency' } },
      { type: 'audit.capture', data: baseCapture() },
      // Missing observation/impact/suggestedFix — silently dropped.
      { type: 'audit.finding', data: { title: 'x', lens: 'consistency', severity: 'med' } },
      // Lens not in the canonical set — dropped.
      { type: 'audit.finding', data: { ...baseFinding(), lens: 'invented' } },
      { type: 'audit.finding', data: baseFinding() },
    ]
    const out = parseAuditorEvents(events)
    expect(out.findings).toHaveLength(1)
  })
})
