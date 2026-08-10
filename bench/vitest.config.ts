import { defineConfig } from 'vitest/config'

// Scoped on purpose: MOST bench *.test.mts files are tsx-run node:test assertion
// scripts (see HARNESS.md), not vitest suites, and the repo root vitest config
// excludes bench/** entirely. Every file listed below imports from 'vitest' — which
// is also how scripts/run-package-tests.mjs decides which runner a file needs, so a
// vitest suite must appear here or `vitest run <path>` matches nothing. Run
// from bench/:
//   ../node_modules/.bin/vitest run
export default defineConfig({
  test: {
    include: [
      'src/benchmarks/mcad-bench.test.mts',
      'src/benchmarks/mcad-cq.test.mts',
      'src/official-optimizer-config.test.mts',
      'src/swe-arena/**/*.test.mts',
      'src/quant-arena/**/*.test.mts',
      'src/rollout-ledger/**/*.test.mts',
    ],
  },
})
