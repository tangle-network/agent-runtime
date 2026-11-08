import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// `_wt/` is where this repo's agents park git worktrees for other branches. A worktree holds a
// full checkout, so leaving it collectable runs another branch's tests against THIS branch's
// source and reports their failures as ours.
const exclude = ['**/node_modules/**', 'dist/**', 'bench/**', '**/.claude/worktrees/**', '**/_wt/**']

// Keep the process/deadline suites and the whole real-subprocess contention class out of the
// parallel pool. They spawn real OS processes (seat-pause spawn+poll, the tangle Sandbox provider,
// the in-place CLI harness) and gate on output in short `expect.poll` windows; under pool contention
// a starved subprocess misses the window or a shared-file `JSON.parse(readFile())` reads a torn write
// ("Unexpected end of JSON input"). Serial runs each alone after the pool drains; assertions kept.
// Heavy-but-robust resume/kill suites (durability/*, runtime/supervisor-*) stay in the pool — they
// tolerate process-death timing and serializing them would lengthen the serial wall past baseline.
const serial = [
  'tests/runtime/retained-capture-resume.test.ts',
  'tests/kernel/retained-checkpoint-capture.test.ts',
  'tests/kernel/run-registry-persistence.test.ts',
  'tests/integration/deadline-wake-process.test.ts',
  'tests/integration/uncertain-create-identity.test.ts',
  'tests/integration/seat-pause-*.test.ts',
  'tests/integration/retained-silence.test.ts',
  'tests/integration/provider-trace-root.integration.test.ts',
  'tests/integration/candidate-execution-claim.test.ts',
  'tests/integration/provider-graph-json.test.ts',
  'tests/integration/custom-driver-seats.test.ts',
  'tests/integration/profile-config-preallocation.test.ts',
  'tests/integration/typed-driver-attempts.test.ts',
  'tests/integration/coordination-control-http.test.ts',
  'tests/integration/eager-child-settlement.test.ts',
  'tests/integration/eager-manager-custody.test.ts',
  'tests/integration/graph-file.test.ts',
  'tests/integration/keyed-completion-observation.test.ts',
  'tests/integration/runtime-live-trace.test.ts',
  'tests/integration/stored-graph-command.test.ts',
  'tests/integration/pursuit-versions-http.test.ts',
  'tests/integration/recovered-leaf-custody.test.ts',
  'tests/integration/supervise-parking.test.ts',
  'tests/kernel/in-place-cli-executor.test.ts',
  'tests/kernel/provider-executor-composition.test.ts',
  'tests/agentic-generator.test.ts',
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
    // Several suites drive real fixtures + canonical digests; in isolation each runs well under a
    // second, but the full parallel pool inflates their wall ~10x and brushes vitest's 5s default
    // (measured 3.6-4.1s) — pure CPU contention. 20s absorbs it; a genuine hang still trips. hookTimeout too.
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
