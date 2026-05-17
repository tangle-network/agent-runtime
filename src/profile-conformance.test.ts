import { describe, it, expect } from 'vitest'
import { assertProfileConformance } from './profile-conformance'
import type { AgentProfile, AgentSubagentProfile } from '@tangle-network/sandbox'

const LONG_PROMPT = 'Real partner-quality system prompt body '.repeat(40) // ~1600 chars

function baseProfile(over: Partial<AgentProfile> = {}): AgentProfile {
  return {
    name: 'test-agent',
    prompt: { systemPrompt: LONG_PROMPT },
    ...over,
  } as AgentProfile
}

function realSubagent(): AgentSubagentProfile {
  return {
    description: 'A real specialist for tests' + ' '.padEnd(40, '.'),
    prompt: 'Specialist prompt content. '.repeat(10), // > 100 chars
    metadata: { status: 'full' },
  } as AgentSubagentProfile
}

describe('assertProfileConformance — refuses decorative tools / dead MCP / scaffold-shipped', () => {
  it('passes a well-formed profile', () => {
    const p = baseProfile({
      tools: {},
      mcp: {},
      subagents: { ma: realSubagent() },
    } as Partial<AgentProfile>)
    const r = assertProfileConformance(p)
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('rejects shell capabilities declared as tools (the gtm/creative anti-pattern)', () => {
    const p = baseProfile({
      tools: { bash: true, python: true, curl: true },
    } as Partial<AgentProfile>)
    const r = assertProfileConformance(p)
    expect(r.valid).toBe(false)
    const codes = r.errors.map((e) => e.code)
    expect(codes).toContain('shell-capability-as-tool')
    // All 3 shell caps flagged
    const shellIssues = r.errors.filter((e) => e.code === 'shell-capability-as-tool')
    expect(shellIssues).toHaveLength(3)
  })

  it('rejects decorative tools with no corresponding MCP server', () => {
    const p = baseProfile({
      tools: { 'gtm-twitter-engage': true, 'gtm-seo-check': true },
      mcp: {}, // no MCP wiring
    } as Partial<AgentProfile>)
    const r = assertProfileConformance(p)
    expect(r.valid).toBe(false)
    expect(r.errors.filter((e) => e.code === 'decorative-tool-without-mcp')).toHaveLength(2)
  })

  it('accepts tools-allowed-without-mcp for in-process / file-mounted callable', () => {
    const p = baseProfile({
      tools: { 'agent-knowledge:query': true },
      mcp: {},
    } as Partial<AgentProfile>)
    const r = assertProfileConformance(p, { toolsAllowedWithoutMcp: ['agent-knowledge:query'] })
    expect(r.valid).toBe(true)
  })

  it('rejects too-short system prompt (likely placeholder)', () => {
    const p = baseProfile({ prompt: { systemPrompt: 'Stub' } })
    const r = assertProfileConformance(p)
    expect(r.valid).toBe(false)
    expect(r.errors.find((e) => e.code === 'system-prompt-too-short')).toBeDefined()
  })

  it('warns on scaffold-status subagents by default (router should gate)', () => {
    const scaffold: AgentSubagentProfile = {
      description: 'Scaffold subagent for tests' + ' '.padEnd(40, '.'),
      prompt: 'Scaffold prompt placeholder. '.repeat(10),
      metadata: { status: 'scaffold' },
    } as AgentSubagentProfile
    const p = baseProfile({ subagents: { todo: scaffold } } as Partial<AgentProfile>)
    const r = assertProfileConformance(p)
    expect(r.valid).toBe(true) // warning, not error
    expect(r.warnings.find((w) => w.code === 'subagent-scaffold-shipped')).toBeDefined()
  })

  it('errors on scaffold subagents in strict mode', () => {
    const scaffold: AgentSubagentProfile = {
      description: 'Scaffold subagent for tests' + ' '.padEnd(40, '.'),
      prompt: 'Scaffold prompt placeholder. '.repeat(10),
      metadata: { status: 'scaffold' },
    } as AgentSubagentProfile
    const p = baseProfile({ subagents: { todo: scaffold } } as Partial<AgentProfile>)
    const r = assertProfileConformance(p, { strictNoScaffolds: true })
    expect(r.valid).toBe(false)
    expect(r.errors.find((e) => e.code === 'subagent-scaffold-shipped')).toBeDefined()
  })

  it('rejects subagents with missing/short descriptions or prompts', () => {
    const bad: AgentSubagentProfile = {
      description: 'tiny',
      prompt: 'short',
    } as AgentSubagentProfile
    const p = baseProfile({ subagents: { x: bad } } as Partial<AgentProfile>)
    const r = assertProfileConformance(p)
    expect(r.valid).toBe(false)
    const codes = r.errors.map((e) => e.code)
    expect(codes).toContain('subagent-description-too-short')
    expect(codes).toContain('subagent-prompt-too-short')
  })

  it('result includes machine-friendly path + code for every issue', () => {
    const p = baseProfile({
      tools: { bash: true, 'fake-tool': true },
      mcp: {},
    } as Partial<AgentProfile>)
    const r = assertProfileConformance(p)
    expect(r.errors.find((e) => e.path === 'tools.bash')).toBeDefined()
    expect(r.errors.find((e) => e.path === 'tools.fake-tool')).toBeDefined()
  })

  it('the gtm-agent anti-pattern audit-found is caught', () => {
    const p = baseProfile({
      tools: { bash: true, web: true, 'gtm-seo-check': true, 'gtm-twitter-post': true },
      mcp: {},
    } as Partial<AgentProfile>)
    const r = assertProfileConformance(p)
    expect(r.valid).toBe(false)
    // 2 shell-cap errors (bash, web) + 2 decorative-tool errors (gtm-*)
    expect(r.errors).toHaveLength(4)
  })
})
