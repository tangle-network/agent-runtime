import { defineConfig } from 'vitest/config'

// Scoped to src/swe-arena on purpose: the other bench *.test.mts files are
// tsx-run assertion scripts (see HARNESS.md), not vitest suites, and the repo
// root vitest config excludes bench/** entirely. Run from bench/:
//   ../node_modules/.bin/vitest run
export default defineConfig({
  test: {
    include: ['src/swe-arena/**/*.test.mts', 'src/quant-arena/**/*.test.mts'],
  },
})
