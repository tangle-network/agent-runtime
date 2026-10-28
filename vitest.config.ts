import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// `_wt/` is where this repo's agents park git worktrees for other branches. A worktree holds a
// full checkout, so leaving it collectable runs another branch's tests against THIS branch's
// source and reports their failures as ours.
const exclude = ['**/node_modules/**', 'dist/**', 'bench/**', '**/.claude/worktrees/**', '**/_wt/**']

// Keep process and deadline suites out of the parallel test pool.
const serial = [
  'tests/runtime/retained-capture-resume.test.ts',
  'tests/kernel/retained-checkpoint-capture.test.ts',
  'tests/kernel/run-registry-persistence.test.ts',
  'tests/integration/deadline-wake-process.test.ts',
]

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@tangle-network\/agent-runtime$/,
        replacement: resolve(__dirname, 'src/index.ts'),
      },
      {
        find: /^@tangle-network\/agent-runtime\/kernel$/,
        replacement: resolve(__dirname, 'src/runtime/index.ts'),
      },
      {
        find: /^@tangle-network\/agent-runtime\/testing$/,
        replacement: resolve(__dirname, 'src/testing/index.ts'),
      },
      {
        find: /^@tangle-network\/agent-runtime\/tui$/,
        replacement: resolve(__dirname, 'src/tui/index.ts'),
      },
    ],
  },
  test: {
    // Several suites drive real candidate-experiment fixtures + canonical digests.
    // In isolation each such test runs in well under a second, but under the full
    // parallel pool on a saturated CI runner their wall time inflates ~10x and the
    // heaviest brush vitest's 5s default (measured: 3.6-4.1s under load), a pure
    // CPU-contention timeout with no race behind it. Raise the ceiling so contention
    // does not mint spurious redness; a genuine hang still trips well inside 20s.
    // hookTimeout gets the same headroom: a suite whose fixture setup is compute-bound
    // is subject to the identical contention inflation as its test bodies.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    projects: [
      { extends: true, test: { name: 'parallel', exclude: [...exclude, ...serial] } },
      {
        extends: true,
        test: {
          name: 'serial',
          include: serial,
          exclude,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
