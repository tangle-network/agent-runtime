import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

/** Separate vitest config used by `pnpm test:workers` so the main suite stays
 *  on the default Node pool; only the workerd-only `*.workers.test.ts` files
 *  run inside the real Cloudflare runtime via `@cloudflare/vitest-pool-workers`. */
export default defineWorkersConfig({
  test: {
    include: ['tests/workers/**/*.workers.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.workers.toml' },
      },
    },
  },
})
