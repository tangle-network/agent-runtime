import { execFileSync } from 'node:child_process'
import { profileChatClient, profileOptimizerModelCall } from '../../../src/runtime/index.ts'
import { createWorktreeCliExecutor } from '../../../src/runtime/supervise/worktree-cli-executor.ts'

const repository = process.argv[2]
if (!repository) throw new Error('repository argument required')

const profile = {
  name: 'exact-native-chat',
  harness: 'codex',
  model: { provider: 'openai', default: 'gpt-5.4' },
  prompt: { instructions: ['Follow the supplied task.'] },
}
const bridge = { bridgeUrl: 'http://127.0.0.1:1', bridgeBearer: 'unused-no-dispatch' }
const native = { backend: 'cli-worktree', repoRoot: repository, codexReproducible: true }
const cases = [
  ['cli', { backend: 'cli', bin: process.execPath, args: ['--version'], cwd: repository }],
  ['cli-in-place', { backend: 'cli-in-place', workspacePath: repository }],
  ['cli-worktree', native],
  ['cli-worktree-bridge', { backend: 'cli-worktree', repoRoot: repository, bridge }],
  ['bridge-json', { backend: 'bridge', ...bridge, outputFormat: 'json' }],
]
const worktrees = () =>
  execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repository,
    encoding: 'utf8',
  })
const before = worktrees()
const admission = []
for (const [name, executor] of cases) {
  for (const [adapter, bind] of [
    ['chat', profileChatClient],
    ['optimizer', profileOptimizerModelCall],
  ]) {
    let error = null
    try {
      bind({ profile, executor, context: `transport admission ${name}` })
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    admission.push({ name, adapter, error })
  }
}

// These are real adapter constructions, not substituted executors or model responses.
// A live call remains conditional on the transport reporting its observed model.
const supported = []
for (const [name, executor] of [
  ['bridge', { backend: 'bridge', ...bridge }],
  [
    'router',
    { backend: 'router', routerBaseUrl: 'http://127.0.0.1:1/v1', routerKey: 'unused-no-dispatch' },
  ],
]) {
  for (const [adapter, bind] of [
    ['chat', profileChatClient],
    ['optimizer', profileOptimizerModelCall],
  ]) {
    bind({ profile, executor, context: `supported transport ${name}` })
    supported.push({ name, adapter })
  }
}

// Exact chat admission must not disable the ordinary, metered worktree executor.
// Construction materializes its plan without launching Codex or reading credentials.
const executor = createWorktreeCliExecutor({ ...native, profile })
await executor.teardown('graceful')
process.stdout.write(
  JSON.stringify({
    admission,
    supported,
    nativeBudgetExempt: executor.budgetExempt,
    before,
    after: worktrees(),
  }),
)
