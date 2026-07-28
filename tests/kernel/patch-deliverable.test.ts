import { describe, expect, it } from 'vitest'
import { isNonEmptyPatch, touchesSecretPath } from '../../src/runtime/supervise/patch-checks'
import { patchDelivered } from '../../src/runtime/supervise/patch-deliverable'
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

describe('isNonEmptyPatch / touchesSecretPath — the standalone safety floors (public API)', () => {
  it('isNonEmptyPatch: true for a real touched path + body, false for empty/whitespace-only', () => {
    expect(isNonEmptyPatch(goodPatch)).toBe(true)
    expect(isNonEmptyPatch('')).toBe(false)
    expect(isNonEmptyPatch('   \n  \t')).toBe(false)
    // headers with no content body still counts a touched path, but a blank trim is rejected:
    expect(isNonEmptyPatch('--- a/src/x.ts\n+++ b/src/x.ts\n')).toBe(true)
  })

  it('touchesSecretPath: returns the matched credential paths, empty array for a clean patch', () => {
    const env = 'diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n+SECRET=1'
    const key = '--- a/deploy/id_rsa\n+++ b/deploy/id_rsa\n+x'
    expect(touchesSecretPath(env)).toEqual(['.env'])
    expect(touchesSecretPath(key)).toEqual(['deploy/id_rsa'])
    expect(touchesSecretPath(goodPatch)).toEqual([])
  })
})

describe('patchDelivered — the mechanical patch gate as a DeliverableSpec', () => {
  it('rejects an empty patch (no-op floor)', async () => {
    const ok = await patchDelivered().check(artifact(''))
    expect(ok).toBe(false)
  })

  it('rejects a patch touching a secret-shaped path (always-on floor, no config needed)', async () => {
    const patch = 'diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n+SECRET=1'
    expect(await patchDelivered().check(artifact(patch))).toBe(false)
  })

  it('rejects a patch touching a forbidden path', async () => {
    const patch = 'diff --git a/protected/x b/protected/x\n--- a/protected/x\n+++ b/protected/x\n+x'
    const ok = await patchDelivered({ forbiddenPaths: ['protected'] }).check(artifact(patch))
    expect(ok).toBe(false)
  })

  it('rejects a diff above the size cap', async () => {
    const big = [
      'diff --git a/src/x.ts b/src/x.ts',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      ...Array.from({ length: 10 }, (_, i) => `+line ${i}`),
    ].join('\n')
    expect(await patchDelivered({ maxDiffLines: 5 }).check(artifact(big))).toBe(false)
  })

  it('accepts a clean patch when no test/typecheck signal is required', async () => {
    expect(await patchDelivered().check(artifact(goodPatch))).toBe(true)
  })

  it('fails closed when a required signal was never derived (no command run)', async () => {
    // require tests, but the artifact carries no checks → fail closed (honest).
    expect(await patchDelivered({ require: ['tests'] }).check(artifact(goodPatch))).toBe(false)
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
    const spec = patchDelivered({ require: ['tests', 'typecheck'] })
    expect(await spec.check(passing)).toBe(true)
    expect(await spec.check(failingTest)).toBe(false)
  })
})
