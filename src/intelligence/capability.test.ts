import { describe, expect, it } from 'vitest'
import { manifestFromProfile } from './capability'
import type { CertifiedProfile } from './delivery'

const wireProfile: CertifiedProfile = {
  target: 'support-agent',
  generatedAt: '2026-06-13T00:00:00.000Z',
  agentProfileDiffs: [],
  capabilities: [],
  agentProfile: null,
  promptSurface: {
    surface: 'Confirm the invoice id before refunding.',
    surfaceHash: 'abc123',
    version: 4,
    lift: '+3.1pp',
  },
  artifacts: {
    skill: [
      {
        path: 'skills/refunds/SKILL.md',
        content: 'Refund flow: verify, then issue.',
        contentHash: 'd1',
        version: 2,
        lift: '+1.2pp',
        promotedAt: '2026-06-12T00:00:00.000Z',
      },
    ],
  },
}

describe('manifestFromProfile', () => {
  it('round-trips a CertifiedProfile into context capabilities + carries promptSurface', () => {
    const m = manifestFromProfile(wireProfile)
    expect(m.target).toBe('support-agent')
    expect(m.promptSurface?.version).toBe(4)
    expect(m.capabilities).toHaveLength(1)
    const cap = m.capabilities[0]!
    expect(cap.iface).toMatchObject({ surface: 'context', kind: 'skill' })
    expect(cap.binding.kind).toBe('inline')
    expect(cap.provenance.contentHash).toBe('d1')
    expect(cap.provenance.sourcePath).toBe('skills/refunds/SKILL.md')
  })

  it('infers an http tool from a tool-shaped artifact', () => {
    const profile: CertifiedProfile = {
      target: 't',
      generatedAt: 'g',
      promptSurface: null,
      agentProfileDiffs: [],
      capabilities: [],
      agentProfile: null,
      artifacts: {
        tool: [
          {
            path: 'tools/fx.json',
            content: JSON.stringify({
              name: 'fx_convert',
              parameters: { type: 'object' },
              url: 'https://fx.test/convert',
            }),
            contentHash: 'd2',
            version: 1,
            lift: null,
            promotedAt: 'p',
          },
        ],
      },
    }
    const cap = manifestFromProfile(profile).capabilities[0]!
    expect(cap.iface.surface).toBe('tool')
    expect(cap.binding.kind).toBe('http')
  })

  it('infers an mcp-stdio binding from a command-shaped artifact', () => {
    const profile: CertifiedProfile = {
      target: 't',
      generatedAt: 'g',
      promptSurface: null,
      agentProfileDiffs: [],
      capabilities: [],
      agentProfile: null,
      artifacts: {
        mcp: [
          {
            path: 'mcp/ticketing.json',
            content: JSON.stringify({ name: 'ticketing', command: 'node', args: ['server.js'] }),
            contentHash: 'd3',
            version: 1,
            lift: null,
            promotedAt: 'p',
          },
        ],
      },
    }
    const cap = manifestFromProfile(profile).capabilities[0]!
    expect(cap.iface).toMatchObject({ surface: 'mcp', serverName: 'ticketing' })
    expect(cap.binding.kind).toBe('mcp-stdio')
  })

  it('falls back to context/inline for an unparseable artifact', () => {
    const profile: CertifiedProfile = {
      target: 't',
      generatedAt: 'g',
      promptSurface: null,
      agentProfileDiffs: [],
      capabilities: [],
      agentProfile: null,
      artifacts: {
        notes: [
          {
            path: 'n.txt',
            content: 'free text',
            contentHash: 'd',
            version: null,
            lift: null,
            promotedAt: 'p',
          },
        ],
      },
    }
    const cap = manifestFromProfile(profile).capabilities[0]!
    expect(cap.iface.surface).toBe('context')
    expect(cap.binding.kind).toBe('inline')
  })
})
