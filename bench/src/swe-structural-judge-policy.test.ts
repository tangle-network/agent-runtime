import assert from 'node:assert/strict'
import { linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { createFingerprints } from './swe-structural-provenance'
import {
  assertCompleteTaskSet,
  assertDistinctArtifactPaths,
  assertJudgeCompletionMatchesInput,
  assertJudgeResumeFingerprints,
  assertPairedExecutionFingerprint,
  assertPairedFingerprints,
  completeJudgeScore,
} from './swe-structural-judge-policy'

const inputs = {
  source: 'source',
  config: { arm: 'independent-2' },
  commonConfig: { model: 'worker' },
  repro: 'repro',
  prompt: 'prompt',
  tools: ['run'],
  task: 'task',
}

describe('judge-only admission', () => {
  it('requires a complete Phase-A task set before scoring', () => {
    assert.doesNotThrow(() => assertCompleteTaskSet(['a', 'b'], ['a', 'b'], 'left'))
    assert.throws(() => assertCompleteTaskSet(['a'], ['a', 'b'], 'left'), /incomplete Phase A/)
  })

  it('accepts arm-specific config hashes but rejects any shared-input mismatch', () => {
    const left = createFingerprints(inputs)
    const right = createFingerprints({ ...inputs, config: { arm: 'persistent-refine-2' } })
    assert.doesNotThrow(() => assertPairedFingerprints(left, right, 'task'))
    const changedTools = createFingerprints({ ...inputs, config: { arm: 'persistent-refine-2' }, tools: ['edit'] })
    assert.throws(() => assertPairedFingerprints(left, changedTools, 'task'), /paired tools fingerprints/)
    assert.doesNotThrow(() => assertPairedExecutionFingerprint('execution', 'execution', 'task'))
    assert.throws(() => assertPairedExecutionFingerprint('left', 'right', 'task'), /paired execution/)
  })

  it('rejects a judge resume row tied to different Phase-A bytes', () => {
    const expected = {
      pairFingerprint: 'pair',
      phaseFileFingerprint: 'phase-new',
      inputFingerprint: 'input',
      executionFingerprint: 'execution',
      finalDiffHash: 'diff',
    }
    assert.doesNotThrow(() => assertJudgeResumeFingerprints(expected, expected, 'row'))
    assert.throws(() =>
      assertJudgeResumeFingerprints({ ...expected, phaseFileFingerprint: 'phase-old' }, expected, 'row'),
      /phaseFileFingerprint mismatch/,
    )
  })

  it('returns only completed scores and propagates scorer failures for retry', async () => {
    assert.deepEqual(await completeJudgeScore('', async () => ({ resolved: true })), {
      hiddenResolved: false,
      judgeDetail: null,
      judgeSkipped: 'empty-patch',
    })
    await assert.rejects(
      completeJudgeScore('diff --git a/a b/a', async () => {
        throw new Error('transient scorer failure')
      }),
      /transient scorer failure/,
    )
    assert.deepEqual(await completeJudgeScore('diff', async () => ({ resolved: true, detail: 'ok' })), {
      hiddenResolved: true,
      judgeDetail: 'ok',
      judgeSkipped: null,
    })
    assert.doesNotThrow(() =>
      assertJudgeCompletionMatchesInput(
        { hiddenResolved: false, judgeDetail: null, judgeSkipped: 'empty-patch' },
        '',
        'row',
      ),
    )
    assert.throws(() =>
      assertJudgeCompletionMatchesInput(
        { hiddenResolved: false, judgeDetail: null, judgeSkipped: 'empty-patch' },
        'diff',
        'row',
      ),
      /non-empty patch cannot skip/,
    )
  })

  it('rejects relative, symlink, and hardlink aliases before scoring', () => {
    const dir = mkdtempSync(join(tmpdir(), 'swe-judge-paths-'))
    try {
      const phase = join(dir, 'phase-a.jsonl')
      const other = join(dir, 'phase-b.jsonl')
      const symlink = join(dir, 'phase-link.jsonl')
      const hardlink = join(dir, 'phase-hard.jsonl')
      writeFileSync(phase, '{}\n')
      writeFileSync(other, '{}\n')
      symlinkSync(phase, symlink)
      linkSync(phase, hardlink)

      assert.throws(() =>
        assertDistinctArtifactPaths({ phase, alias: relative(process.cwd(), phase), out: join(dir, 'out.jsonl') }),
        /alias the same artifact file/,
      )
      assert.throws(() => assertDistinctArtifactPaths({ phase, symlink, out: join(dir, 'out.jsonl') }),
        /alias the same artifact file/,
      )
      assert.throws(() => assertDistinctArtifactPaths({ phase, hardlink, other }), /alias the same artifact file/)
      assert.doesNotThrow(() => assertDistinctArtifactPaths({ phase, other, out: join(dir, 'out.jsonl') }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
