import {
  type AgentCandidateTaskOutcomeSpec,
  agentCandidateTerminationSchema,
  agentCandidateWorkspaceManifestMaterialSchema,
} from '@tangle-network/agent-interface'
import { assertExactObjectKeys as assertExactKeys } from './exact-object'
import type { AgentCandidateExecutorFinalCapture, AgentCandidateProtectedRunCapture } from './types'

const sealedFinalCaptureBrand: unique symbol = Symbol('sealedAgentCandidateExecutorFinalCapture')

export type SealedAgentCandidateExecutorFinalCapture = AgentCandidateExecutorFinalCapture & {
  readonly [sealedFinalCaptureBrand]: true
}

/** Validate and detach the only candidate-authored fields accepted from execution. */
export function sealAgentCandidateProtectedRunCapture(
  value: unknown,
): AgentCandidateProtectedRunCapture {
  const capture = requireRecord(value, 'candidate execution capture')
  assertExactKeys(capture, ['executionId', 'termination'], 'candidate execution capture')
  if (typeof capture.executionId !== 'string' || capture.executionId.length === 0) {
    throw new Error('candidate execution capture has an invalid executionId')
  }
  return Object.freeze({
    executionId: capture.executionId,
    termination: Object.freeze(agentCandidateTerminationSchema.parse(capture.termination)),
  })
}

/** Validate, detach, and freeze evaluator-owned evidence captured after process death. */
export function sealAgentCandidateExecutorFinalCapture(
  value: unknown,
  expectedOutcome: AgentCandidateTaskOutcomeSpec,
): SealedAgentCandidateExecutorFinalCapture {
  const capture = requireRecord(value, 'candidate final capture')
  assertExactKeys(capture, [], 'candidate final capture', [
    'taskOutcome',
    'memoryAfter',
    'evidence',
  ])

  const taskOutcome = capture.taskOutcome
    ? sealTaskOutcomeCapture(capture.taskOutcome, expectedOutcome)
    : undefined
  const memoryAfter = capture.memoryAfter ? sealMemoryCapture(capture.memoryAfter) : undefined
  if (capture.evidence !== undefined && !(capture.evidence instanceof Uint8Array)) {
    throw new Error('candidate executor evidence must be a byte array')
  }
  const evidence = capture.evidence ? Uint8Array.from(capture.evidence) : undefined
  return Object.freeze({
    ...(taskOutcome ? { taskOutcome } : {}),
    ...(memoryAfter ? { memoryAfter: Object.freeze(memoryAfter) } : {}),
    ...(evidence ? { evidence } : {}),
    [sealedFinalCaptureBrand]: true as const,
  })
}

/** Prove exact process death before any final evidence capture. */
export function sealAgentCandidateExecutorStopAcknowledgement(value: unknown): void {
  const capture = requireRecord(value, 'candidate stop acknowledgement')
  assertExactKeys(capture, ['stopped'], 'candidate stop acknowledgement')
  if (capture.stopped !== true) {
    throw new Error('candidate stop acknowledgement does not prove process death')
  }
}

function sealMemoryCapture(
  value: unknown,
): NonNullable<AgentCandidateExecutorFinalCapture['memoryAfter']> {
  const capture = requireRecord(value, 'candidate memory capture')
  assertExactKeys(capture, ['afterState', 'archive'], 'candidate memory capture')
  if (!(capture.archive instanceof Uint8Array)) {
    throw new Error('candidate memory capture archive must be a byte array')
  }
  return Object.freeze({
    afterState: Object.freeze(
      agentCandidateWorkspaceManifestMaterialSchema.parse(capture.afterState),
    ),
    archive: Uint8Array.from(capture.archive),
  })
}

function sealTaskOutcomeCapture(
  value: unknown,
  expected: AgentCandidateTaskOutcomeSpec,
): NonNullable<AgentCandidateExecutorFinalCapture['taskOutcome']> {
  const capture = requireRecord(value, 'candidate task capture')
  if (capture.kind === 'output') {
    assertExactKeys(capture, ['kind', 'bytes'], 'candidate task output capture')
    if (expected.kind !== 'output') {
      throw new Error('candidate task output capture does not match the signed outcome kind')
    }
    if (!(capture.bytes instanceof Uint8Array)) {
      throw new Error('candidate task output capture must contain a byte array')
    }
    if (capture.bytes.byteLength > expected.maxBytes) {
      throw new Error(`candidate task output exceeds the frozen ${expected.maxBytes}-byte maximum`)
    }
    return Object.freeze({ kind: 'output', bytes: Uint8Array.from(capture.bytes) })
  }
  assertExactKeys(
    capture,
    ['kind', 'resultTree', 'afterState', 'archive', 'gitDiff'],
    'candidate task capture',
  )
  if (capture.kind !== 'workspace') {
    throw new Error('candidate task capture has an invalid outcome kind')
  }
  if (expected.kind !== 'workspace') {
    throw new Error('candidate workspace capture does not match the signed outcome kind')
  }
  if (
    typeof capture.resultTree !== 'string' ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(capture.resultTree)
  ) {
    throw new Error('candidate task capture resultTree is not a Git object id')
  }
  if (!(capture.archive instanceof Uint8Array) || !(capture.gitDiff instanceof Uint8Array)) {
    throw new Error('candidate task capture archive and gitDiff must be byte arrays')
  }
  const afterState = agentCandidateWorkspaceManifestMaterialSchema.parse(capture.afterState)
  return Object.freeze({
    kind: 'workspace',
    resultTree: capture.resultTree,
    afterState: Object.freeze(afterState),
    archive: Uint8Array.from(capture.archive),
    gitDiff: Uint8Array.from(capture.gitDiff),
  })
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}
