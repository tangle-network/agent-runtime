/**
 * Chat-model resolution + catalog admission — the one primitive every
 * product chat handler needs and was hand-rolling per repo. Runs offline
 * via an injected `loadModels`.
 *
 * Run with:
 *   pnpm tsx examples/model-resolution/model-resolution.ts
 */

import {
  cleanModelId,
  type ModelInfo,
  resolveChatModel,
  resolveRouterBaseUrl,
  validateChatModelId,
  withConfiguredModels,
} from '@tangle-network/agent-runtime'

// Imagine this came from the Tangle Router. A real product calls `getModels`.
const catalog: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
]
const loadModels = async () => catalog

async function main() {
  // 1. Router base URL — env-driven, normalised (no trailing /v1 or /).
  const env = { TANGLE_ROUTER_URL: 'https://router.tangle.tools/v1/' }
  console.log('routerBaseUrl:', resolveRouterBaseUrl(env))

  // 2. Precedence resolution — first non-blank wins; caller owns the order.
  const resolved = resolveChatModel(
    [
      { source: 'request', model: undefined }, // user did not pin one
      { source: 'workspace', model: '  ' }, // workspace pin is blank
      { source: 'env', model: 'claude-sonnet-4-6' }, // env wins
    ],
    { source: 'default', model: 'claude-sonnet-4-6' },
  )
  console.log('resolved:     ', resolved) // { source: 'env', model: 'claude-sonnet-4-6' }

  // 3. Catalog admission — fail-closed: malformed ids, unknown ids, and a
  // failed router fetch all reject. An allowlist (your default + any
  // env-configured ids) short-circuits the catalog round-trip.
  const accepted = await validateChatModelId(resolved.model, {
    allowlist: ['claude-sonnet-4-6'],
    loadModels,
  })
  console.log('accepted:     ', accepted) // { succeeded: true, value: '...' }

  const rejected = await validateChatModelId('not in catalog', { loadModels })
  console.log('rejected:     ', rejected) // { succeeded: false, error: '...' }

  const malformed = await validateChatModelId('has spaces!', { loadModels })
  console.log('malformed:    ', malformed) // { succeeded: false, error: 'malformed' }

  // 4. Inject env-configured ids into the catalog the picker shows the user.
  const picker = withConfiguredModels(catalog, ['private/internal-model'])
  console.log('picker first: ', picker[0]?.id) // 'private/internal-model'

  // 5. Helpers
  console.log('cleanModelId: ', cleanModelId('  gpt-4o  ')) // 'gpt-4o'
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
