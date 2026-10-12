import { describe, expect, it } from 'vitest'
import { canonicalCandidateDigest, type AgentExactRunControlRef } from '@tangle-network/agent-interface'
import {
  execOnlyEnvironmentCapabilities,
  type AgentEnvironment,
  type AgentEnvironmentProvider,
  type AgentTurnInput,
} from '@tangle-network/agent-interface/environment-provider'
import { retainedContextTransfer, retainedContextTransferReceipt, retainedContextProfile } from './retained-context-transfer-fixture'
import { recoverRetainedRun, startRetainedRun } from './retained-run-start'
import type { RetainedRunAdmission, RetainedRunIntentAdmission, RetainedRunStartMaterial } from './retained-run-types'

function fixture() {
  const request = retainedContextTransfer()
  const receipt = retainedContextTransferReceipt(request)
  const counts = { creates: 0, gets: 0, dispatches: 0, destroys: 0 }
  const admissions: RetainedRunAdmission[] = []
  let received: AgentTurnInput | undefined
  const capabilities = { ...execOnlyEnvironmentCapabilities({ read: true, write: true, exec: true, git: true, upload: false, download: false }),
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: false, messages: false },
    retainedControl: { exactRunIdentity: true, resultIdentity: true, eventIdentity: true, cancellationIdempotency: true },
    contextTransfer: { freshSession: true, requestIdempotency: true, lookup: true, attach: true } }
  const controlRef: AgentExactRunControlRef = { provider: receipt.provider, environmentId: receipt.environmentId,
    sessionId: receipt.sessionId, executionId: receipt.executionId, runId: receipt.runId,
    requestDigest: canonicalCandidateDigest({ prompt: 'first turn', turnId: 'braid-product-turn' }) }
  const session = { id: receipt.sessionId, controlRef, status: async () => 'running' as const,
    async *events() {}, result: async () => ({ text: 'done', success: true }),
    prompt: async () => ({ text: 'continued', success: true }), cancel: async () => {} }
  const environment: AgentEnvironment = {
    id: receipt.environmentId, provider: receipt.provider, capabilities, contextTransferReceipt: { ...receipt, status: 'replayed' },
    status: async () => 'running', async *stream() {},
    dispatch: async (input) => { counts.dispatches++; received = input; return { id: session.id, controlRef } },
    session: () => session, destroy: async () => { counts.destroys++ },
  }
  const createProvider = (): AgentEnvironmentProvider => ({ name: receipt.provider, capabilities: () => capabilities,
    create: async () => { counts.creates++; throw new Error('attachment must never create') },
    get: async (id, options) => { counts.gets++; expect(id).toBe(receipt.environmentId); expect(options?.contextTransfer).toEqual(request); return environment } })
  const material: RetainedRunStartMaterial = { environment: { profile: retainedContextProfile, backend: 'codex', idempotencyKey: 'braid-admission-key' },
    turn: { prompt: 'first turn', turnId: 'braid-product-turn', contextTransfer: request }, contextTransferReceipt: receipt }
  return { request, receipt, material, counts, admissions, controlRef, capabilities, environment, createProvider,
    received: () => received, onAdmission: async (admission: RetainedRunAdmission) => { admissions.push(admission) } }
}

describe('retained context transfer attachment', () => {
  it('attaches the accepted environment and dispatches the exact provider run without create', async () => {
    const f = fixture()
    const run = await startRetainedRun({ ...f.material, provider: f.createProvider(), onAdmission: f.onAdmission })
    expect(run.controlRef).toEqual(f.controlRef)
    expect(run.controlRef.runId).not.toBe(f.material.turn.turnId)
    expect(f.received()).toMatchObject({ contextTransfer: f.request, sessionId: f.receipt.sessionId,
      executionId: f.receipt.executionId, turnId: 'braid-product-turn', detach: true })
    expect(f.counts).toEqual({ creates: 0, gets: 1, dispatches: 1, destroys: 0 })
    expect(f.admissions.map(a => a.phase)).toEqual(['intent', 'environment', 'dispatched'])
    expect(JSON.stringify(f.admissions)).not.toContain('portable context')
  })

  it('replays a serialized pre-attachment intent after process state is discarded', async () => {
    const f = fixture()
    let saved: RetainedRunIntentAdmission | undefined
    await expect(startRetainedRun({ ...f.material, provider: f.createProvider(), onAdmission: async admission => {
      if (admission.phase === 'intent') { saved = JSON.parse(JSON.stringify(admission)); throw new Error('coordinator stopped') }
    } })).rejects.toThrow(/admission/)
    expect(f.counts).toEqual({ creates: 0, gets: 0, dispatches: 0, destroys: 0 })
    const restored = JSON.parse(JSON.stringify({ ...f.material, contextTransferReceipt: { ...f.receipt, status: 'replayed' } })) as RetainedRunStartMaterial
    const result = await recoverRetainedRun({ provider: f.createProvider(), admission: saved!, replay: restored, onAdmission: f.onAdmission })
    expect(result.outcome).toBe('recovered')
    expect(f.counts).toEqual({ creates: 0, gets: 1, dispatches: 1, destroys: 0 })
  })

  it.each(['receipt', 'profile', 'workspace', 'resources', 'identity', 'provider', 'create-options'])(
    'refuses changed %s before provider effects', async kind => {
      const f = fixture()
      const material = structuredClone(f.material)
      if (kind === 'receipt') Object.assign(material.contextTransferReceipt!, { runId: 'wrong-run' })
      if (kind === 'profile') Object.assign(material.environment, { profile: { name: 'different-agent' } })
      if (kind === 'workspace') Object.assign(material.environment, { workspace: { image: 'another-image' } })
      if (kind === 'resources') Object.assign(material.environment, { resources: { cpu: 8 } })
      if (kind === 'identity') Object.assign(material, { identity: { sessionId: 'wrong-session', executionId: f.receipt.executionId } })
      if (kind === 'provider') Object.assign(material.turn.contextTransfer!.plan.destination, { provider: 'another-provider' })
      if (kind === 'create-options') Object.assign(material.environment, { env: { PRIVATE_TOKEN: 'must-not-enter-admission' } })
      await expect(startRetainedRun({ ...material, provider: f.createProvider(), onAdmission: f.onAdmission })).rejects.toThrow()
      expect(f.counts).toEqual({ creates: 0, gets: 0, dispatches: 0, destroys: 0 })
      expect(f.admissions).toEqual([])
    },
  )

  it('requires the accepted receipt and attachment capability without falling back to create', async () => {
    const f = fixture()
    const { contextTransferReceipt: _receipt, ...withoutReceipt } = f.material
    await expect(startRetainedRun({ ...withoutReceipt, provider: f.createProvider(), onAdmission: f.onAdmission })).rejects.toThrow(/accepted receipt/)
    f.capabilities.contextTransfer.attach = false
    await expect(startRetainedRun({ ...f.material, provider: f.createProvider(), onAdmission: f.onAdmission })).rejects.toThrow(/cannot attach/)
    expect(f.counts).toEqual({ creates: 0, gets: 0, dispatches: 0, destroys: 0 })
  })

  it('binds a matching replacement operation to the saved intent before another lookup', async () => {
    const f = fixture()
    let saved: RetainedRunIntentAdmission | undefined
    await expect(startRetainedRun({ ...f.material, provider: f.createProvider(), onAdmission: async admission => {
      if (admission.phase === 'intent') { saved = structuredClone(admission); throw new Error('stopped') }
    } })).rejects.toThrow(/admission/)
    const request = retainedContextTransfer('replacement-operation')
    await expect(startRetainedRun({ ...f.material, turn: { ...f.material.turn, contextTransfer: request },
      contextTransferReceipt: retainedContextTransferReceipt(request), intent: saved!, provider: f.createProvider(),
      onAdmission: f.onAdmission })).rejects.toThrow(/intent conflicts/)
    expect(f.counts).toEqual({ creates: 0, gets: 0, dispatches: 0, destroys: 0 })
  })

  it.each(['environment', 'turn'] as const)('cancels authoritative attachment from the %s signal without dispatch or cleanup', async source => {
    const f = fixture()
    const controller = new AbortController()
    const provider = f.createProvider()
    let receivedSignal: AbortSignal | undefined
    provider.get = async (_id, options) => {
      f.counts.gets++
      receivedSignal = options?.signal
      controller.abort(new Error('attachment cancelled'))
      return f.environment
    }
    const material = { ...f.material,
      environment: { ...f.material.environment, ...(source === 'environment' ? { signal: controller.signal } : {}) },
      turn: { ...f.material.turn, ...(source === 'turn' ? { signal: controller.signal } : {}) } }
    await expect(startRetainedRun({ ...material, provider, onAdmission: f.onAdmission })).rejects.toThrow('attachment cancelled')
    expect(receivedSignal?.aborted).toBe(true)
    expect(f.admissions.map(admission => admission.phase)).toEqual(['intent'])
    expect(f.counts).toEqual({ creates: 0, gets: 1, dispatches: 0, destroys: 0 })
  })

  it.each(['missing-environment', 'missing-receipt', 'changed-receipt', 'capabilities', 'dispatch', 'run-binding', 'durability'])(
    'preserves the accepted destination on %s failure', async kind => {
      const f = fixture()
      const provider = f.createProvider()
      // Even an incorrect creation marker on reconstruction cannot grant Runtime cleanup authority.
      Object.assign(f.environment, { creation: 'created' })
      if (kind === 'missing-environment') provider.get = async () => { f.counts.gets++; return null }
      if (kind === 'missing-receipt') Object.assign(f.environment, { contextTransferReceipt: undefined })
      if (kind === 'changed-receipt') Object.assign(f.environment, { contextTransferReceipt: { ...f.receipt, admittedAt: '2026-08-01T20:01:03.000Z' } })
      if (kind === 'capabilities') Object.assign(f.environment, { capabilities: { ...f.capabilities, contextTransfer: undefined } })
      if (kind === 'dispatch') f.environment.dispatch = async () => { throw new Error('response lost') }
      if (kind === 'run-binding') Object.assign(f.controlRef, { runId: 'wrong-provider-run' })
      await expect(startRetainedRun({ ...f.material, provider, onAdmission: async admission => {
        if (kind === 'durability' && admission.phase === 'environment') throw new Error('journal unavailable')
      } })).rejects.toThrow()
      expect(f.counts.creates).toBe(0)
      expect(f.counts.destroys).toBe(0)
    },
  )
})
