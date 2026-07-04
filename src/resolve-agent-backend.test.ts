import { describe, expect, it, vi } from 'vitest'
import type { AgentExecutionBackend } from './types'

const createOpenAICompatibleBackend = vi.fn((config: unknown): AgentExecutionBackend => {
  return {
    kind: (config as { kind?: string }).kind ?? 'tcloud',
    stream: async function* () {},
    __config: config,
  } as unknown as AgentExecutionBackend
})

vi.mock('./backends', () => ({ createOpenAICompatibleBackend }))

const { resolveAgentBackend } = await import('./resolve-agent-backend')

const configOf = (backend: AgentExecutionBackend): Record<string, unknown> =>
  (backend as unknown as { __config: Record<string, unknown> }).__config

const base = { apiKey: 'sk-x', baseUrl: 'https://router.tangle.tools/v1', model: 'kimi' }

describe('resolveAgentBackend', () => {
  it("kind 'tcloud' builds createOpenAICompatibleBackend with kind defaulting to the kind name", () => {
    const backend = resolveAgentBackend({ kind: 'tcloud', ...base })
    expect(configOf(backend)).toEqual({ ...base, kind: 'tcloud' })
  })

  it("kind 'router' routes through createOpenAICompatibleBackend (same endpoint as tcloud)", () => {
    const backend = resolveAgentBackend({ kind: 'router', ...base })
    expect(configOf(backend)).toEqual({ ...base, kind: 'router' })
  })

  it("kind 'cli-bridge' routes through createOpenAICompatibleBackend and forwards model", () => {
    const backend = resolveAgentBackend({
      kind: 'cli-bridge',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:3355/v1',
      model: 'claude-code/sonnet',
    })
    // cli-bridge REQUIRES model — the whole reason it uses this factory.
    expect(configOf(backend)).toEqual({
      apiKey: '',
      baseUrl: 'http://127.0.0.1:3355/v1',
      model: 'claude-code/sonnet',
      kind: 'cli-bridge',
    })
  })

  it('honors an explicit label over the kind name', () => {
    const backend = resolveAgentBackend({
      kind: 'tcloud',
      ...base,
      label: 'insurance-canonical-tcloud',
    })
    expect((configOf(backend) as { kind: string }).kind).toBe('insurance-canonical-tcloud')
  })

  it('forwards openai-compat passthrough (tools, fetchImpl) when set', () => {
    const tools = [
      { type: 'function', function: { name: 'submit', description: 'd', parameters: {} } },
    ] as never
    const fetchImpl = (async () => new Response()) as unknown as typeof fetch
    const backend = resolveAgentBackend({ kind: 'cli-bridge', ...base, tools, fetchImpl })
    const cfg = configOf(backend)
    expect(cfg.tools).toBe(tools)
    expect(cfg.fetchImpl).toBe(fetchImpl)
  })

  it('forwards generation options when set', () => {
    const backend = resolveAgentBackend({
      kind: 'router',
      ...base,
      temperature: 1,
      maxTokens: 8192,
    })
    const cfg = configOf(backend)
    expect(cfg.temperature).toBe(1)
    expect(cfg.maxTokens).toBe(8192)
  })

  it('omits passthrough fields that were never set (keeps the tool-free request shape)', () => {
    const backend = resolveAgentBackend({ kind: 'tcloud', ...base })
    const cfg = configOf(backend)
    expect('tools' in cfg).toBe(false)
    expect('toolChoice' in cfg).toBe(false)
    expect('responseFormat' in cfg).toBe(false)
    expect('temperature' in cfg).toBe(false)
    expect('maxTokens' in cfg).toBe(false)
    expect('fetchImpl' in cfg).toBe(false)
    expect('retry' in cfg).toBe(false)
  })

  it("kind 'sandbox' invokes the caller's sandboxBackend seam", () => {
    const sandbox = {
      kind: 'product-sandbox',
      stream: async function* () {},
    } as AgentExecutionBackend
    const sandboxBackend = vi.fn(() => sandbox)
    const backend = resolveAgentBackend({ kind: 'sandbox', ...base, sandboxBackend })
    expect(backend).toBe(sandbox)
    expect(sandboxBackend).toHaveBeenCalledOnce()
    expect(createOpenAICompatibleBackend).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sandbox' }),
    )
  })

  it("kind 'sandbox' fails loud when no sandboxBackend seam is provided", () => {
    expect(() => resolveAgentBackend({ kind: 'sandbox', ...base })).toThrow(
      /requires opts\.sandboxBackend/,
    )
  })
})
