import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertFingerprintsEqual,
  createExecutionReceipt,
  createFingerprints,
  diffChanged,
  diffFingerprint,
  fingerprint,
  runtimeImplementationFingerprint,
} from './swe-structural-provenance'

const inputs = {
  source: { files: ['runner', 'environment'] },
  config: { arm: 'independent-2', k: 2 },
  commonConfig: { model: 'worker' },
  repro: { script: 'raise SystemExit(1)' },
  prompt: 'prompt',
  tools: [{ name: 'run' }],
  task: { id: 'repo__repo-1' },
}

describe('structural provenance', () => {
  it('hashes objects independent of key insertion order', () => {
    assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }))
  })

  it('rejects a changed resume input by its named fingerprint', () => {
    const expected = createFingerprints(inputs)
    const actual = createFingerprints({ ...inputs, prompt: 'changed prompt' })
    assert.throws(() => assertFingerprintsEqual(actual, expected, 'resume row'), /prompt fingerprint mismatch/)
  })

  it('records identical and changed continuation patches exactly', () => {
    const parent = 'diff --git a/a.py b/a.py\n+x\n'
    assert.match(diffFingerprint(parent), /^sha256:[0-9a-f]{64}$/)
    assert.equal(diffChanged(parent, parent), false)
    assert.equal(diffChanged(parent, `${parent}+y\n`), true)
  })

  it('binds actual runtime callables, run settings, scorer version, and immutable image identity', () => {
    const runtime = runtimeImplementationFingerprint({
      runAgentic: function runAgenticA() { return 'a' },
      refine: { name: 'refine', driver: function refineA() { return 'a' } },
    })
    const changedRuntime = runtimeImplementationFingerprint({
      runAgentic: function runAgenticB() { return 'b' },
      refine: { name: 'refine', driver: function refineA() { return 'a' } },
    })
    assert.notEqual(changedRuntime, runtime)

    const shared = {
      runTool: { timeoutS: 120, outputLimit: 10_000 },
      runtimeImplementationFingerprint: runtime,
      runtimeTreeFingerprint: fingerprint({ runtime: 'tree-a' }),
      officialScorer: {
        package: 'swebench' as const,
        version: '4.0.0',
        cacheLevel: 'instance' as const,
        namespacePolicy: 'phase-a-image' as const,
      },
    }
    const receipt = createExecutionReceipt(shared, {
      tag: 'sweb.eval.example:latest',
      namespace: 'swebench',
      identity: { id: 'sha256:image-a', repoDigests: ['sweb.eval.example@sha256:digest-a'] },
    })
    const movedTag = createExecutionReceipt(shared, {
      tag: 'sweb.eval.example:latest',
      namespace: 'swebench',
      identity: { id: 'sha256:image-b', repoDigests: ['sweb.eval.example@sha256:digest-b'] },
    })
    const movedRuntimeTree = createExecutionReceipt(
      { ...shared, runtimeTreeFingerprint: fingerprint({ runtime: 'tree-b' }) },
      {
        tag: 'sweb.eval.example:latest',
        namespace: 'swebench',
        identity: { id: 'sha256:image-a', repoDigests: ['sweb.eval.example@sha256:digest-a'] },
      },
    )
    const movedScorer = createExecutionReceipt(
      { ...shared, officialScorer: { ...shared.officialScorer, version: '4.0.1' } },
      {
        tag: 'sweb.eval.example:latest',
        namespace: 'swebench',
        identity: { id: 'sha256:image-a', repoDigests: ['sweb.eval.example@sha256:digest-a'] },
      },
    )
    assert.notEqual(fingerprint(receipt), fingerprint(movedTag))
    assert.notEqual(fingerprint(receipt), fingerprint(movedRuntimeTree))
    assert.notEqual(fingerprint(receipt), fingerprint(movedScorer))
  })
})
