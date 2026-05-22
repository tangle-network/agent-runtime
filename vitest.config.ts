import { defineConfig } from 'vitest/config'

/** Default Node-pool vitest run. The workerd-only suite under
 *  `tests/workers/**` runs separately via `pnpm test:workers` against
 *  `vitest.workers.config.ts` — it imports `cloudflare:test`, which only
 *  resolves inside `@cloudflare/vitest-pool-workers`. */
export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'dist/**', 'tests/workers/**'],
  },
})
