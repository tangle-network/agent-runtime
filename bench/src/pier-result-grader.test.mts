import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import type { AgentCandidateArtifactRef } from '@tangle-network/agent-interface'

import { createPierResultGrader } from './pier-result-grader'

const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

const artifact: AgentCandidateArtifactRef = {
  locator: { kind: 's3', bucket: 'pier-graders', key: 'pier-result-grader.mjs' },
  sha256: `sha256:${'a'.repeat(64)}`,
  byteLength: 1,
}

test('executes admitted Pier grader bytes over exact official result evidence', async () => {
  const implementation = await readFile(new URL('./pier-result-grader.mjs', import.meta.url))
  const resultBytes = Buffer.from(
    JSON.stringify({ verifier_result: { rewards: { reward: 1, patch_applied: 1 } } }),
  )
  const grader = createPierResultGrader({ name: 'pier-result', version: '1', artifact })
  const output = await grader.run({
    executionId: 'execution-1',
    termination: { kind: 'exit', exitCode: 0 },
    outcome: { evidence: { digest: `sha256:${'b'.repeat(64)}` } } as never,
    implementation: { byteLength: implementation.byteLength, bytes: implementation },
    signal: new AbortController().signal,
    officialResult: { value: JSON.parse(resultBytes.toString('utf8')), bytes: resultBytes },
  })

  assert.deepEqual(output.evaluation, {
    score: 1,
    passed: true,
    dimensions: { patch_applied: 1, reward: 1 },
    raw: {},
  })
  assert.deepEqual(Buffer.from(output.evidence), resultBytes)
  assert.equal(output.binding.implementationDigest, digest(implementation))
  assert.equal(output.binding.outputDigest, digest(resultBytes))
})

test('fails closed for missing official rewards and pre-aborted execution', async () => {
  const implementation = await readFile(new URL('./pier-result-grader.mjs', import.meta.url))
  const grader = createPierResultGrader({ name: 'pier-result', version: '1', artifact })
  const base = {
    executionId: 'execution-1',
    termination: { kind: 'exit', exitCode: 0 } as const,
    outcome: { evidence: { digest: `sha256:${'b'.repeat(64)}` } } as never,
    implementation: { byteLength: implementation.byteLength, bytes: implementation },
    officialResult: { value: {}, bytes: Buffer.from('{}') },
  }
  await assert.rejects(
    grader.run({ ...base, signal: new AbortController().signal }),
    /omitted verifier_result.rewards/,
  )
  const controller = new AbortController()
  controller.abort(new Error('deadline'))
  await assert.rejects(grader.run({ ...base, signal: controller.signal }), /deadline/)
})
