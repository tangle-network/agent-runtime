// worktreeLoopRunner — the smallest end-to-end coder loop on the generic recursive path:
// author one AgentProfile per harness, fan them out over worktree-CLI leaves, gate each on
// patchDelivered, and pick the winning patch with the shared valid-only selector. See README.md.

import { worktreeLoopRunner } from '@tangle-network/agent-runtime'
import type { AgentProfile } from '@tangle-network/sandbox'

const profile = (name: string): AgentProfile => ({
  name,
  prompt: { systemPrompt: `You are ${name}. Deliver a minimal, correct patch.` },
})

// ── Offline test seams ───────────────────────────────────────────────────
// A fake git that hands every worktree the same one-line patch, a no-op harness
// runner, and a passing check runner. Production callers leave these unset (the
// runner drives the real claude/codex/opencode CLIs on real worktrees).
const patch = [
  'diff --git a/util.ts b/util.ts',
  '--- a/util.ts',
  '+++ b/util.ts',
  '+export const add = (a: number, b: number): number => a + b',
].join('\n')

async function main(): Promise<void> {
  const runner = worktreeLoopRunner({
    repoRoot: '/tmp/coder-loop-example',
    taskPrompt: 'add util.ts that exports add(a, b)',
    budget: { maxIterations: 50, maxTokens: 500_000 },
    harnesses: [
      { name: 'claude', profile: profile('claude'), harness: 'claude' },
      { name: 'opencode', profile: profile('opencode'), harness: 'opencode' },
    ],
    testCmd: 'node -e \'require("./util").add(1,2)===3 || process.exit(1)\'',
    typecheckCmd: 'pnpm typecheck',
    require: ['tests', 'typecheck'],
    maxDiffLines: 50,
    forbiddenPaths: ['secrets/', 'node_modules/'],
    runGit: (args: readonly string[]) => {
      if (args[0] === 'diff' && args.includes('--shortstat')) {
        return { stdout: ' 1 file changed, 1 insertion(+), 0 deletions(-)\n', stderr: '', exitCode: 0 }
      }
      if (args[0] === 'diff') return { stdout: patch, stderr: '', exitCode: 0 }
      if (args[0] === 'rev-parse') return { stdout: 'base\n', stderr: '', exitCode: 0 }
      return { stdout: '', stderr: '', exitCode: 0 }
    },
    runHarness: async () => ({
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      killedBySignal: null,
      durationMs: 1,
      timedOut: false,
    }),
    runCommand: async () => ({ exitCode: 0, output: 'green' }),
  })

  const winner = await runner(new AbortController().signal)
  console.log(`winning branch: ${winner.branch}`)
  console.log(`  diff (${winner.stats.insertions} insertions):`)
  for (const line of winner.patch.split('\n')) console.log(`    ${line}`)
  console.log(`  tests passed: ${winner.checks?.tests?.passed ?? '(not run)'}`)
  console.log(`  typecheck passed: ${winner.checks?.typecheck?.passed ?? '(not run)'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
