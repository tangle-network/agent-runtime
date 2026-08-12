import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recoverRetainedRun, startRetainedRun } from '../../src/runtime/retained-run'
import { mintRetainedIdentity } from '../../src/runtime/retained-run-start'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { tangleShapedProvider } from '../helpers/tangle-shaped-provider'

describe('retained run recovery against a tangle-shaped provider', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent-runtime-retained-recovery-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('reports a live run as unverifiable when the provider cannot self-identify its session', async () => {
    const stateFile = join(directory, 'tangle-shaped-provider.json')
    const provider = tangleShapedProvider(durableRetainedProvider(stateFile))
    const minted = mintRetainedIdentity('shape', 'shape')

    const run = await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'shape' },
      turn: { prompt: 'go', turnId: 'shape' },
      onAdmission: async () => {},
    })
    expect(run.controlRef).toMatchObject(minted)

    // The run is LIVE, but a bare session(id) yields no stored reference, so
    // recovery must answer unverifiable — never not_found, never a throw.
    const result = await recoverRetainedRun({
      provider,
      environmentId: 'environment-shape',
      sessionId: minted.sessionId,
      executionId: minted.executionId,
    })
    expect(result.outcome).toBe('unverifiable')
    if (result.outcome === 'unverifiable') {
      expect(result.environment.id).toBe('environment-shape')
    }
    await expect(provider.get?.('environment-shape')).resolves.not.toBeNull()
  })

  it('answers unverifiable for a session id the provider never committed', async () => {
    const stateFile = join(directory, 'tangle-shaped-uncommitted.json')
    const provider = tangleShapedProvider(durableRetainedProvider(stateFile))

    await startRetainedRun({
      provider,
      environment: { profile: { name: 'worker' }, idempotencyKey: 'shape' },
      turn: { prompt: 'go', turnId: 'shape' },
      onAdmission: async () => {},
    })

    // A lazy accessor returns a session object for ANY id; the answer for an
    // uncommitted id is indistinguishable from a live one: unverifiable.
    const result = await recoverRetainedRun({
      provider,
      environmentId: 'environment-shape',
      sessionId: 'never-dispatched',
      executionId: 'never',
    })
    expect(result.outcome).toBe('unverifiable')
  })
})
