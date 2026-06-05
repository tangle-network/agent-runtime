import { describe, expect, it } from 'vitest'
import {
  type Check,
  defaultChecks,
  liftFindings,
  makeCheckRunner,
  renderTrace,
  runCheck,
} from '../../src/mcp/tools/checks'

const kind: Check = defaultChecks.completeness as Check
const AT = '2026-06-05T00:00:00.000Z'

describe('analyst-kind directory', () => {
  it('ships a directory of distinct lenses (not one question)', () => {
    const ids = Object.keys(defaultChecks)
    expect(ids).toEqual(
      expect.arrayContaining(['completeness', 'correctness', 'policy', 'efficiency', 'tool-use']),
    )
    // distinct lenses → distinct `lookFor` + areas (not the same question N times)
    const lookFors = new Set(Object.values(defaultChecks).map((k) => k.lookFor))
    expect(lookFors.size).toBe(ids.length)
  })

  it('liftFindings parses raw rows → AnalystFinding (stamped, tagged by kind) and is firewalled', () => {
    const findings = liftFindings(
      kind,
      [
        {
          severity: 'high',
          claim: 'the SLA was never linked',
          evidence_uri: 'span://t1/s9',
          confidence: 0.85,
          recommended_action: 'Link the SLA.',
        },
        { not: 'a valid finding' }, // dropped by validateRawFinding (no claim/evidence_uri)
      ],
      AT,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.analyst_id).toBe('completeness')
    expect(findings[0]?.area).toBe('failure-mode')
    expect(findings[0]?.finding_id).toBeTruthy()
    expect(findings[0]?.evidence_refs[0]).toMatchObject({ kind: 'span', uri: 'span://t1/s9' })
  })

  it('firewall rejects a judge-derived finding (selector ≠ judge)', () => {
    expect(() =>
      liftFindings(
        kind,
        [{ severity: 'high', claim: 'low score', evidence_uri: 'metric://score', confidence: 0.9 }],
        AT,
      ),
    ).toThrow(/judge-derived|selector ≠ judge|steer-firewall/)
  })

  it('renderTrace handles a {messages} conversation and a bare array', () => {
    const t = renderTrace({
      messages: [
        { role: 'assistant', tool_calls: [{ function: { name: 'update', arguments: '{"x":1}' } }] },
        { role: 'tool', content: 'ok' },
      ],
    })
    expect(t).toContain('CALL update')
    expect(t).toContain('RESULT ok')
  })

  it('runCheck applies the lens via an injected chat → findings', async () => {
    const chat = async () =>
      '```json\n[{"severity":"medium","claim":"incidents not migrated","evidence_uri":"artifact://db.json","confidence":0.7}]\n```'
    const out = await runCheck(
      kind,
      { messages: [] },
      { routerBaseUrl: 'x', routerKey: 'x', model: 'm', chat },
      AT,
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.claim).toBe('incidents not migrated')
    expect(out[0]?.evidence_refs[0]?.kind).toBe('artifact')
  })

  it('makeCheckRunner dispatches by kind id; unknown kind → typed error', async () => {
    const chat = async () => '```json\n[]\n```'
    const run = makeCheckRunner(defaultChecks, {
      routerBaseUrl: 'x',
      routerKey: 'x',
      model: 'm',
      chat,
    })
    expect(await run('completeness', { messages: [] }, AT)).toEqual([])
    expect(await run('nope', {}, AT)).toEqual({
      error: expect.stringContaining('unknown analyst kind'),
    })
  })
})
