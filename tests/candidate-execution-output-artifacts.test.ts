import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { persistCandidateOutputArtifact } from '../src/candidate-execution/output-artifacts'
import type { AgentCandidateOutputArtifactPort } from '../src/candidate-execution/types'
import { candidateSha } from './helpers/candidate-execution-fixture'

describe('candidate output artifact persistence', () => {
  it('does not call the durable store after result cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('result deadline'))
    let puts = 0
    const port: AgentCandidateOutputArtifactPort = {
      put: async () => {
        puts++
        throw new Error('must not write')
      },
      read: async () => new Uint8Array(),
    }

    await expect(
      persistCandidateOutputArtifact(port, {
        executionId: 'execution-1',
        purpose: 'trace',
        bytes: Buffer.from('late'),
        signal: controller.signal,
      }),
    ).rejects.toThrow(/result deadline/)
    expect(puts).toBe(0)
  })

  it('reads back exact durable bytes before returning the locator', async () => {
    const bytes = Buffer.from('durable outcome')
    const stored = new Map<string, Uint8Array>()
    const port: AgentCandidateOutputArtifactPort = {
      put: async ({ bytes: value }) => {
        const ref = {
          locator: { kind: 's3' as const, bucket: 'candidate-results', key: 'outcome.bin' },
          sha256: `sha256:${createHash('sha256').update(value).digest('hex')}` as const,
          byteLength: value.byteLength,
        }
        stored.set(ref.sha256, Uint8Array.from(value))
        return ref
      },
      read: async (ref) => stored.get(ref.sha256) ?? new Uint8Array(),
    }

    await expect(
      persistCandidateOutputArtifact(port, {
        executionId: 'execution-1',
        purpose: 'task-patch',
        bytes,
      }),
    ).resolves.toMatchObject({ byteLength: bytes.byteLength })
  })

  it('rejects a locator that lies about the submitted content', async () => {
    const port: AgentCandidateOutputArtifactPort = {
      put: async () => ({
        locator: { kind: 's3', bucket: 'candidate-results', key: 'wrong.bin' },
        sha256: candidateSha('f'),
        byteLength: 1,
      }),
      read: async () => Uint8Array.from([0]),
    }
    await expect(
      persistCandidateOutputArtifact(port, {
        executionId: 'execution-1',
        purpose: 'trace',
        bytes: Buffer.from('expected'),
      }),
    ).rejects.toThrow(/does not identify/)
  })
})
