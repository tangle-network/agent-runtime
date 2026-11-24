import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { HANG_BOUND_MS } from './tests/helpers/observable-state'

// `_wt/` is where this repo's agents park git worktrees for other branches. A worktree holds a
// full checkout, so leaving it collectable runs another branch's tests against THIS branch's
// source and reports their failures as ours.
const exclude = ['**/node_modules/**', 'dist/**', 'bench/**', '**/.claude/worktrees/**', '**/_wt/**']

// The proofs that read RUNTIME_FULL_PLACEMENT_WINDOWS. With it set they wait out the SDK's and
// Runtime's default placement windows (8 to 20 minutes of outage, little CPU), so release:check
// runs this project as its own lane beside the rest of its vitest run (scripts/run-beside.mjs),
// after its last build: provider-retained-observation-http loads dist/.
const placementWindows = [
  'tests/integration/placement-capacity-deadline.test.ts',
  'tests/integration/placement-capacity-room.test.ts',
  'tests/integration/provider-retained-observation-http.test.ts',
]

// Keep the process/deadline suites and the whole real-subprocess contention class out of the
// parallel pool. They spawn real OS processes (seat-pause spawn+poll, the tangle Sandbox provider,
// the in-place CLI harness) and gate on output in `expect.poll` windows; under pool contention
// a starved subprocess misses the window or a shared-file `JSON.parse(readFile())` reads a torn write
// ("Unexpected end of JSON input"). Serial runs each alone after the pool drains; assertions kept.
// Heavy-but-robust resume/kill suites (durability/*, runtime/supervisor-*) stay in the pool — they
// tolerate process-death timing and serializing them would lengthen the serial wall past baseline.
const serial = [
  // The archive qualification writes about 9 GiB when it cannot use tmpfs. Other tests fsync.
  'tests/candidate-workspace-streaming-memory.test.ts',
  // Knowledge activation hashes and restores real snapshots. Concurrent filesystem suites
  // exhausted its time bound before the explicit-default and research restores finished.
  'tests/knowledge-improvement-job.test.ts',
  // These exercise a bounded trainer subprocess and the viewer's discovery latency.
  'tests/profile-training.test.ts',
  'tests/integration/top-web.test.ts',
  'tests/runtime/retained-capture-resume.test.ts',
  'tests/kernel/retained-checkpoint-capture.test.ts',
  'tests/kernel/run-registry-persistence.test.ts',
  'tests/integration/child-admission-grant.test.ts',
  'tests/integration/deadline-wake-process.test.ts',
  'tests/integration/flow-model-admission.test.ts',
  'tests/integration/retained-interactive-delegation.test.ts',
  'tests/integration/retained-tail-window.test.ts',
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
    // `test:affected` runs `vitest run --changed <merge base>`. A change to any of these files can
    // move every test without appearing in a test's import graph, so it runs the whole suite.
    forceRerunTriggers: [
      '**/package.json',
      '**/pnpm-lock.yaml',
      '**/pnpm-workspace.yaml',
      '**/vitest.config.*',
      '**/vite.config.*',
      '**/tsconfig*.json',
      '**/tsdown.config.*',
    ],
    // Several suites drive real fixtures + canonical digests; the full parallel pool inflates
    // their wall time under shared-runner contention. 60s absorbs it; a genuine hang still trips.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // `expect.poll` waits for a state; its timeout only names a hang. Vitest's 1 s default stood in
    // for the state's arrival and failed while it was on its way on a loaded gate host.
    expect: { poll: { timeout: HANG_BOUND_MS } },
    projects: [
      {
        extends: true,
        test: { name: 'parallel', exclude: [...exclude, ...serial, ...placementWindows] },
      },
      { extends: true, test: { name: 'placement-windows', include: placementWindows, exclude } },
      {
        extends: true,
        plugins: [
          {
            name: 'serial-file-limit',
            configureVitest({ project }) {
              // Vitest 5 applies the runner's worker ceiling after resolving fileParallelism.
              project.config.maxWorkers = 1
            },
          },
        ],
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
