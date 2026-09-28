import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import { isolatedCheckBoxEvidenceSchema, isolatedCheckResultSchema } from '../../src/index'
import type { IsolatedCheckBoxEvidence, IsolatedCheckResult } from '../../src/runtime/isolated-checker'

const input = { kind: 'agent-candidate-workspace-manifest' as const, files: [] }
const box = {
  sandboxId: 'fixture-box', account: 'fixture-checker', input,
  inputDigest: canonicalCandidateDigest(input),
}

describe('isolated check receipt protocol', () => {
  it('matches the existing public execution types in both directions', () => {
    expectTypeOf<z.output<typeof isolatedCheckResultSchema>>().toEqualTypeOf<IsolatedCheckResult>()
    expectTypeOf<z.output<typeof isolatedCheckBoxEvidenceSchema>>().toEqualTypeOf<IsolatedCheckBoxEvidence>()
  })

  it('retains the complete success receipt without altering its canonical identity', () => {
    const value = {
      succeeded: true as const, value: { stdout: 'answer', stderr: '' },
      box: { ...box, memoryMB: 256 },
    }
    const parsed = isolatedCheckResultSchema.parse(JSON.parse(JSON.stringify(value)))
    expect(parsed).toEqual(value)
    expect(canonicalCandidateDigest(parsed)).toBe(canonicalCandidateDigest(value))
  })

  it.each(['refused', 'failed', 'timeout', 'cancelled', 'output-limit', 'input-limit', 'cleanup-failed'])(
    'retains %s and both primary and cleanup evidence', reason => {
      const value = {
        succeeded: false, reason, diagnostic: 'primary', stdout: 'partial', stderr: 'error',
        exitCode: null, cleanupDiagnostic: 'cleanup', box,
      }
      expect(isolatedCheckResultSchema.parse(value)).toEqual(value)
    },
  )

  it('rejects missing fields, invented verdicts and changed input evidence', () => {
    expect(isolatedCheckResultSchema.safeParse({ succeeded: true }).success).toBe(false)
    expect(isolatedCheckResultSchema.safeParse({ succeeded: false, reason: 'invented', diagnostic: '' }).success).toBe(false)
    expect(isolatedCheckResultSchema.safeParse({
      succeeded: true, value: { stdout: '', stderr: '' }, admitted: true,
    }).success).toBe(false)
    expect(isolatedCheckResultSchema.safeParse({
      succeeded: true, value: { stdout: '', stderr: '' },
      box: { ...box, inputDigest: `sha256:${'f'.repeat(64)}` },
    }).success).toBe(false)
  })
})
