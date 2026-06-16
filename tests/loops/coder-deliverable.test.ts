import { describe, expect, it } from 'vitest'
import { coderDeliverable } from '../../src/runtime/supervise/coder-deliverable'
import type { WorktreePatchArtifact } from '../../src/runtime/supervise/worktree-cli-executor'

function artifact(patch: string, checks?: WorktreePatchArtifact['checks']): WorktreePatchArtifact {
  return {
    branch: 'delegate/x',
    patch,
    stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    harness: {
      name: 'opencode',
      exitCode: 0,
      timedOut: false,
      killedBySignal: null,
      durationMs: 1,
      stdout: '',
      stderr: '',
    },
    ...(checks ? { checks } : {}),
  }
}

const goodPatch = 'diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n+const a = 1'

describe('coderDeliverable — the re-homed mechanical coder gate', () => {
  it('rejects an empty patch (no-op floor)', async () => {
    const ok = await coderDeliverable().check(artifact(''))
    expect(ok).toBe(false)
  })

  it('rejects a patch touching a secret-shaped path (always-on floor, no config needed)', async () => {
    const patch = 'diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n+SECRET=1'
    expect(await coderDeliverable().check(artifact(patch))).toBe(false)
  })

  it('rejects a patch touching a forbidden path', async () => {
    const patch = 'diff --git a/protected/x b/protected/x\n--- a/protected/x\n+++ b/protected/x\n+x'
    const ok = await coderDeliverable({ forbiddenPaths: ['protected'] }).check(artifact(patch))
    expect(ok).toBe(false)
  })

  it('rejects a diff above the size cap', async () => {
    const big = [
      'diff --git a/src/x.ts b/src/x.ts',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      ...Array.from({ length: 10 }, (_, i) => `+line ${i}`),
    ].join('\n')
    expect(await coderDeliverable({ maxDiffLines: 5 }).check(artifact(big))).toBe(false)
  })

  it('accepts a clean patch when no test/typecheck signal is required', async () => {
    expect(await coderDeliverable().check(artifact(goodPatch))).toBe(true)
  })

  it('fails closed when a required signal was never derived (no command run)', async () => {
    // require tests, but the artifact carries no checks → fail closed (honest).
    expect(await coderDeliverable({ require: ['tests'] }).check(artifact(goodPatch))).toBe(false)
  })

  it('gates on the derived test/typecheck PASS signals when required', async () => {
    const passing = artifact(goodPatch, {
      tests: { command: 'pnpm test', passed: true, exitCode: 0, output: 'ok' },
      typecheck: { command: 'pnpm tsc', passed: true, exitCode: 0, output: 'ok' },
    })
    const failingTest = artifact(goodPatch, {
      tests: { command: 'pnpm test', passed: false, exitCode: 1, output: 'boom' },
      typecheck: { command: 'pnpm tsc', passed: true, exitCode: 0, output: 'ok' },
    })
    const spec = coderDeliverable({ require: ['tests', 'typecheck'] })
    expect(await spec.check(passing)).toBe(true)
    expect(await spec.check(failingTest)).toBe(false)
  })
})
