import { defineConfig } from 'vitest/config'

// Scoped to the arena + rollout-ledger suites on purpose: the other bench
// *.test.mts files are tsx-run assertion scripts (see HARNESS.md), not vitest
// suites, and the repo root vitest config excludes bench/** entirely. Run
// from bench/:
//   ../node_modules/.bin/vitest run
export default defineConfig({
  test: {
    // SQLite-backed backfill fixtures need more than Vitest's 5s default when
    // the repository suite is running alongside the bench workers.
    testTimeout: 15_000,
    include: [
      'src/swe-arena/**/*.test.mts',
      'src/quant-arena/**/*.test.mts',
      'src/rollout-ledger/**/*.test.mts',
    ],
  },
})
