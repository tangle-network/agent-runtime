import { describe, expect, it } from 'vitest'
import {
  parseAuditorEvents,
  type UiAuditCapture,
  type UiFinding,
} from '../../src/profiles/ui-auditor'

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
