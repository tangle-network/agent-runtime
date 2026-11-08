import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// `_wt/` is where this repo's agents park git worktrees for other branches. A worktree holds a
// full checkout, so leaving it collectable runs another branch's tests against THIS branch's
// source and reports their failures as ours.
const exclude = ['**/node_modules/**', 'dist/**', 'bench/**', '**/.claude/worktrees/**', '**/_wt/**']

// Keep the process/deadline and real-subprocess seat-pause + retained-silence suites out of the
// parallel pool: contention starves their subprocesses past short `expect.poll` windows and tears
// a shared-file `JSON.parse(readFile())` ("Unexpected end of JSON input"). Serial, alone; asserts kept.
const serial = [
  'tests/runtime/retained-capture-resume.test.ts',
  'tests/kernel/retained-checkpoint-capture.test.ts',
  'tests/kernel/run-registry-persistence.test.ts',
  'tests/integration/deadline-wake-process.test.ts',
  'tests/integration/uncertain-create-identity.test.ts',
  'tests/integration/seat-pause-*.test.ts',
  'tests/integration/retained-silence.test.ts',
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
    // Several suites drive real fixtures + canonical digests. In isolation each runs well under a
    // second, but under the full parallel pool on a saturated runner their wall time inflates ~10x
    // and brushes vitest's 5s default (measured 3.6-4.1s) — pure CPU contention, no race. 20s keeps
    // contention from minting spurious redness while a genuine hang still trips; hookTimeout matches.
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
