import {
  agentCandidateTerminationSchema,
  agentCandidateWorkspaceManifestMaterialSchema,
} from '@tangle-network/agent-interface'

import type { AgentCandidateExecutorFinalCapture, AgentCandidateProtectedRunCapture } from './types'

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
): AgentCandidateExecutorFinalCapture {
  const capture = requireRecord(value, 'candidate final capture')
  assertExactKeys(capture, ['stopped', 'taskOutcome', 'memoryAfter'], 'candidate final capture', [
    'taskOutcome',
    'memoryAfter',
  ])
  if (capture.stopped !== true) {
    throw new Error('candidate final capture does not prove process death')
  }

  const taskOutcome = capture.taskOutcome ? sealTaskOutcomeCapture(capture.taskOutcome) : undefined
  const memoryAfter = capture.memoryAfter ? sealMemoryCapture(capture.memoryAfter) : undefined
  return Object.freeze({
    stopped: true,
    ...(taskOutcome ? { taskOutcome } : {}),
    ...(memoryAfter ? { memoryAfter: Object.freeze(memoryAfter) } : {}),
  })
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
): NonNullable<AgentCandidateExecutorFinalCapture['taskOutcome']> {
  const capture = requireRecord(value, 'candidate task capture')
  assertExactKeys(
    capture,
    ['resultTree', 'afterState', 'archive', 'gitDiff'],
    'candidate task capture',
  )
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

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set(expected)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`)
  }
  const optionalKeys = new Set(optional)
  for (const key of expected) {
    if (!optionalKeys.has(key) && !(key in value)) {
      throw new Error(`${label} is missing field ${key}`)
    }
  }
}
