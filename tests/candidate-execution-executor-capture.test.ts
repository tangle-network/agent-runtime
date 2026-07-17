import { describe, expect, it } from 'vitest'

import {
  sealAgentCandidateExecutorFinalCapture,
  sealAgentCandidateExecutorStopAcknowledgement,
} from '../src/candidate-execution/executor-capture'

describe('candidate executor capture', () => {
  it('checks the signed output limit before detaching exact bytes', () => {
    expect(() =>
      sealAgentCandidateExecutorFinalCapture(
        {
          taskOutcome: { kind: 'output', bytes: new Uint8Array(5) },
        },
        { kind: 'output', mediaType: 'application/octet-stream', maxBytes: 4 },
      ),
    ).toThrow(/4-byte maximum/)

    const source = Uint8Array.from([1, 2, 3])
    const capture = sealAgentCandidateExecutorFinalCapture(
      { taskOutcome: { kind: 'output', bytes: source } },
      { kind: 'output', mediaType: 'application/octet-stream', maxBytes: 3 },
    )
    source[0] = 9
    expect(capture.taskOutcome).toMatchObject({ kind: 'output', bytes: Uint8Array.from([1, 2, 3]) })
  })

  it('rejects a capture that disagrees with the signed result kind', () => {
    expect(() =>
      sealAgentCandidateExecutorFinalCapture(
        { taskOutcome: { kind: 'output', bytes: Uint8Array.from([1]) } },
        { kind: 'workspace' },
      ),
    ).toThrow(/signed outcome kind/)
  })

  it('seals stop independently from replayable capture evidence', () => {
    expect(() => sealAgentCandidateExecutorStopAcknowledgement({ stopped: true })).not.toThrow()
    expect(() =>
      sealAgentCandidateExecutorStopAcknowledgement({ stopped: true, taskOutcome: {} }),
    ).toThrow(/unknown field taskOutcome/)
  })
})
