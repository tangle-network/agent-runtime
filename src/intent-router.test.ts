import type { AgentProfile, AgentSubagentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { classifyIntent } from './intent-router'

function profile(subagents: Record<string, AgentSubagentProfile>): AgentProfile {
  return { name: 'test-agent', subagents } as AgentProfile
}

function subagent(
  prompt: string,
  matchers?: unknown,
  status: string = 'full',
): AgentSubagentProfile {
  return {
    description: `subagent for tests${' '.padEnd(40, '.')}`,
    prompt,
    metadata: matchers !== undefined ? { matchers, status } : { status },
  } as AgentSubagentProfile
}

describe('classifyIntent — pure subagent router from profile.subagents metadata', () => {
  it('returns null when no subagent has matchers', () => {
    const p = profile({ a: subagent('a-prompt'), b: subagent('b-prompt') })
    const r = classifyIntent(p, 'anything')
    expect(r.id).toBeNull()
    expect(r.score).toBe(0)
  })

  it('scores keyword hits (case-insensitive substring)', () => {
    const p = profile({
      ma: subagent('M&A specialist', {
        keywords: ['earn-out', 'mac clause', 'reps and warranties'],
      }),
      contracts: subagent('Contracts specialist', { keywords: ['msa', 'sla', 'nda'] }),
    })
    const r = classifyIntent(p, 'I need help with an earn-out and MAC clause review')
    expect(r.id).toBe('ma')
    expect(r.score).toBe(2) // 2 keyword hits × default weight 1
  })

  it('scores pattern hits with default 1.5x weight', () => {
    const p = profile({
      tax: subagent('Tax specialist', { patterns: [/qsbs/i, /§\d+/] }),
      legal: subagent('Legal', { keywords: ['contract'] }),
    })
    const r = classifyIntent(p, 'Need to evaluate QSBS rollover under §1045')
    expect(r.id).toBe('tax')
    expect(r.score).toBe(3) // 2 pattern hits × 1.5
  })

  it('respects per-matcher weight override', () => {
    const p = profile({
      a: subagent('A', { keywords: ['foo'], weight: 5 }),
      b: subagent('B', { keywords: ['foo', 'bar'] }),
    })
    const r = classifyIntent(p, 'foo bar')
    expect(r.id).toBe('a') // 5 vs 2
    expect(r.score).toBe(5)
  })

  it('honors minScore — does not route below threshold', () => {
    const p = profile({
      a: subagent('A', { keywords: ['rare-word'], minScore: 2 }),
    })
    const r = classifyIntent(p, 'I said rare-word once')
    expect(r.id).toBeNull() // score 1 < minScore 2
    expect(r.scores.a).toBe(1)
  })

  it('skips subagents in opts.skip', () => {
    const p = profile({
      icp: subagent('ICP', { keywords: ['icp'] }),
      compete: subagent('Compete', { keywords: ['icp'] }),
    })
    const r = classifyIntent(p, 'help me with icp', { skip: ['icp'] })
    expect(r.id).toBe('compete')
  })

  it('filters via opts.filter (e.g., skip scaffolds)', () => {
    const p = profile({
      ready: subagent('Ready', { keywords: ['help'] }, 'full'),
      scaffold: subagent('Scaffold', { keywords: ['help', 'help'] }, 'scaffold'),
    })
    const r = classifyIntent(p, 'i need help', {
      filter: (s) => (s.metadata as Record<string, unknown> | undefined)?.status === 'full',
    })
    expect(r.id).toBe('ready')
  })

  it('returns all scores for telemetry', () => {
    const p = profile({
      a: subagent('A', { keywords: ['x'] }),
      b: subagent('B', { keywords: ['y'] }),
      c: subagent('C', { keywords: ['z'] }),
    })
    const r = classifyIntent(p, 'x and y')
    expect(r.scores).toEqual({ a: 1, b: 1, c: 0 })
    expect(r.evaluated.a!.keywordHits).toBe(1)
    expect(r.evaluated.c!.keywordHits).toBe(0)
  })

  it('handles matcher arrays (declare multiple rule blocks)', () => {
    const p = profile({
      a: subagent('A', [{ keywords: ['contract'] }, { keywords: ['nda'] }, { minScore: 1 }]),
    })
    const r = classifyIntent(p, 'I have a contract and an NDA')
    expect(r.id).toBe('a')
    expect(r.score).toBe(2)
  })

  it('regex patterns can be supplied as RegExp instances', () => {
    const p = profile({
      a: subagent('A', { patterns: [/\$\d+M/i] }),
    })
    const r = classifyIntent(p, 'Selling for $20M next quarter')
    expect(r.id).toBe('a')
  })

  it('regex patterns can be supplied as strings', () => {
    const p = profile({
      a: subagent('A', { patterns: ['\\$\\d+M'] }),
    })
    const r = classifyIntent(p, 'Selling for $20M next quarter')
    expect(r.id).toBe('a')
  })
})
