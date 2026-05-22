import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanModelId,
  DEFAULT_ROUTER_BASE_URL,
  getModels,
  type ModelInfo,
  resolveChatModel,
  resolveRouterBaseUrl,
  validateChatModelId,
  withConfiguredModels,
} from './model-resolution'

const catalog: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', name: 'Sonnet' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
]
const loadModels = async () => catalog

describe('resolveRouterBaseUrl', () => {
  it('defaults to the Tangle Router', () => {
    expect(resolveRouterBaseUrl()).toBe(DEFAULT_ROUTER_BASE_URL)
  })

  it('prefers TANGLE_ROUTER_URL and strips a trailing /v1 + slash', () => {
    expect(resolveRouterBaseUrl({ TANGLE_ROUTER_URL: 'https://r.example.com/v1/' })).toBe(
      'https://r.example.com',
    )
  })

  it('falls back to TANGLE_ROUTER_BASE_URL', () => {
    expect(resolveRouterBaseUrl({ TANGLE_ROUTER_BASE_URL: 'https://b.example.com/' })).toBe(
      'https://b.example.com',
    )
  })
})

describe('cleanModelId', () => {
  it('trims a string', () => {
    expect(cleanModelId('  gpt-4o  ')).toBe('gpt-4o')
  })

  it('returns undefined for non-strings and blanks', () => {
    expect(cleanModelId(42)).toBeUndefined()
    expect(cleanModelId(undefined)).toBeUndefined()
    expect(cleanModelId('   ')).toBeUndefined()
  })
})

describe('resolveChatModel — precedence', () => {
  it('takes the first candidate carrying a non-blank model', () => {
    expect(
      resolveChatModel(
        [
          { source: 'request', model: '  ' },
          { source: 'workspace', model: 'opus' },
          { source: 'env', model: 'sonnet' },
        ],
        { source: 'default', model: 'gpt-4o' },
      ),
    ).toEqual({ source: 'workspace', model: 'opus' })
  })

  it('falls back when every candidate is blank/absent', () => {
    expect(
      resolveChatModel(
        [
          { source: 'request', model: undefined },
          { source: 'env', model: '' },
        ],
        { source: 'default', model: 'gpt-4o' },
      ),
    ).toEqual({ source: 'default', model: 'gpt-4o' })
  })
})

describe('withConfiguredModels', () => {
  it('prepends configured ids the catalog does not already list', () => {
    const result = withConfiguredModels(catalog, ['private/model-x', 'gpt-4o'])
    expect(result[0]?.id).toBe('private/model-x')
    expect(result.filter((m) => m.id === 'gpt-4o')).toHaveLength(1)
  })

  it('returns the catalog unchanged when nothing new is configured', () => {
    expect(withConfiguredModels(catalog, ['gpt-4o', '  '])).toBe(catalog)
  })
})

describe('validateChatModelId — fail-closed admission', () => {
  it('rejects non-strings and blanks', async () => {
    expect((await validateChatModelId(42, { loadModels })).succeeded).toBe(false)
    expect((await validateChatModelId('  ', { loadModels })).succeeded).toBe(false)
  })

  it('rejects a malformed id without hitting the catalog', async () => {
    const result = await validateChatModelId('bad model!!', {
      loadModels: async () => {
        throw new Error('catalog should not be fetched')
      },
    })
    expect(result.succeeded).toBe(false)
    if (!result.succeeded) expect(result.error).toMatch(/malformed/)
  })

  it('accepts an allowlisted id without a catalog round trip', async () => {
    let fetched = false
    const result = await validateChatModelId('my-default-model', {
      allowlist: ['my-default-model'],
      loadModels: async () => {
        fetched = true
        return []
      },
    })
    expect(result).toEqual({ succeeded: true, value: 'my-default-model' })
    expect(fetched).toBe(false)
  })

  it('accepts an id present in the router catalog', async () => {
    expect(await validateChatModelId('claude-sonnet-4-6', { loadModels })).toEqual({
      succeeded: true,
      value: 'claude-sonnet-4-6',
    })
  })

  it('accepts the provider/id form for a catalog model', async () => {
    expect(await validateChatModelId('openai/gpt-4o', { loadModels })).toEqual({
      succeeded: true,
      value: 'openai/gpt-4o',
    })
  })

  it('rejects an id absent from catalog + allowlist', async () => {
    const result = await validateChatModelId('ghost-model', { loadModels })
    expect(result.succeeded).toBe(false)
    if (!result.succeeded) expect(result.error).toMatch(/not available/)
  })

  it('fails closed when the catalog cannot be fetched', async () => {
    const result = await validateChatModelId('ghost-model', {
      loadModels: async () => {
        throw new Error('router down')
      },
    })
    expect(result.succeeded).toBe(false)
    if (!result.succeeded) expect(result.error).toMatch(/Could not validate/)
  })
})

describe('getModels', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the catalog data array on a 2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: catalog }), { status: 200 })),
    )
    expect(await getModels('https://r.example.com')).toEqual(catalog)
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    )
    await expect(getModels('https://r.example.com')).rejects.toThrow(/503/)
  })
})
