/**
 * A session-backed leaf for the re-attach arm of the kill-and-resume conformance suite.
 *
 * This leaf models the executor class the in-doubt refusal exists FOR: an execution that lives
 * OUTSIDE the coordinator process (a sandbox session, a CLI bridge session) and can RE-ATTACH
 * after the coordinator dies. Its "session" is a file — `${dir}/session-<label>.json` — holding
 * the steps the session has completed, so a resumed process finds the session exactly where the
 * killed one left it.
 *
 * The executor participates in the runtime's retained seam: it journals an `execution-admitted`
 * environment claim through `retainedExecutorContext(ctx).onAdmission` BEFORE doing session work
 * (the durable claim `prepareInterruptedExecutors` keys recovery on), and a resume re-attaches —
 * continuing from the persisted steps instead of restarting — when the recovered context carries
 * prior admissions. The caller supplies the SAME factory as `runGraph({ recoverExecutor })`, so a
 * resumed process reconstructs the interrupted child's executor from the journal.
 *
 * Kill points: `session:<label>:step-<n>` fires after step n persists — the instant where the
 * coordinator dies with the session partway done, the exact case that must re-attach.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import {
  type RetainedExecutorContext,
  registerRetainedExecutorPreparation,
  retainedExecutorContext,
} from '../../../src/runtime/supervise/retained-executor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorContext,
  ExecutorFactory,
  ExecutorResult,
  MakeWorkerAgent,
} from '../../../src/runtime/supervise/types'
import type { KillSwitch } from './kill-switch'

export const SESSION_STEPS = 3

interface SessionState {
  steps: number
  done: boolean
}

function readSession(file: string): SessionState {
  if (!existsSync(file)) return { steps: 0, done: false }
  return JSON.parse(readFileSync(file, 'utf8')) as SessionState
}

function writeSession(file: string, state: SessionState): void {
  writeFileSync(file, `${JSON.stringify(state)}\n`)
}

export interface SessionLeafSeam {
  readonly makeLeafAgent: MakeWorkerAgent
  readonly recoverExecutor: ExecutorFactory<unknown>
  /** Session steps that actually RAN, as `<label>:<step>` lines (per process, for uniqueness proof). */
  readonly stepLog: (phase: string) => string[]
  /** `<label>` lines, once per process that re-attached an interrupted session. */
  readonly reattachLog: (phase: string) => string[]
}

export function sessionBackedLeafSeam(
  dir: string,
  phase: string,
  kill: KillSwitch,
): SessionLeafSeam {
  const stepLogPath = `${dir}/session-steps-${phase}.log`
  const reattachLogPath = `${dir}/session-reattach-${phase}.log`
  const record = (file: string, line: string): void => {
    appendFileSync(file, `${line}\n`)
  }
  const readLog = (file: string): string[] => {
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
  }

  const factory: ExecutorFactory<unknown> = (spec, ctx: ExecutorContext) => {
    const label = spec.profile.name ?? 'session'
    const retained = retainedExecutorContext(ctx)
    const sessionFile = join(dir, `session-${label}.json`)
    let artifact: ExecutorResult<unknown> | undefined

    const runSession = async (
      task: unknown,
      viaRecover: boolean,
    ): Promise<ExecutorResult<unknown>> => {
      // A recovered context carries the prior admissions: this is a RE-ATTACH to the exact
      // journaled execution. A session that had already made progress CONTINUES from it (the
      // marker records that); a session that was admitted but never ran a step continues by
      // running its first step — the execution's own continuation, not replacement work.
      const reattaching = viaRecover || (retained?.admissions?.length ?? 0) > 0
      const prior = readSession(sessionFile)
      if (reattaching && prior.steps > 0) record(reattachLogPath, label)
      // The durable admission chain, journaled BEFORE any session work in the journal's
      // retained order (intent, then environment) — what a resume recovers this child by.
      await retained?.onAdmission?.({
        phase: 'intent',
        provider: 'conformance-session',
        idempotencyKey: `session:${label}`,
        turnId: `session:${label}`,
        sessionId: `sess-${label}`,
        executionId: `exec-${label}`,
        runId: 'conformance',
        requestedProfileDigest: canonicalAgentProfileDigest(spec.profile),
        requestDigest: canonicalCandidateDigest(task),
      })
      await retained?.onAdmission?.({
        phase: 'environment',
        provider: 'conformance-session',
        environmentId: `env-${label}`,
        idempotencyKey: `session:${label}`,
        turnId: `session:${label}`,
        sessionId: `sess-${label}`,
        executionId: `exec-${label}`,
      })
      const session = readSession(sessionFile)
      while (session.steps < SESSION_STEPS) {
        session.steps += 1
        writeSession(sessionFile, session)
        record(stepLogPath, `${label}:${session.steps}`)
        kill(`session:${label}:step-${session.steps}`)
        await new Promise((r) => setTimeout(r, 20))
      }
      session.done = true
      writeSession(sessionFile, session)
      artifact = {
        outRef: `session:${label}:${session.steps}`,
        out: { node: label, steps: session.steps },
        verdict: { valid: true, score: 1 },
        spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
      }
      return artifact
    }

    const executor: Executor<unknown> = {
      // NOT inline: this execution outlives the coordinator by construction — the in-doubt
      // refusal is the correct answer for it when no recovery is wired.
      runtime: 'session',
      async execute(task: unknown) {
        return runSession(task, false)
      },
      /** Re-attach the exact journaled execution: continue the session where it stands, never
       * restart it. The scope requires this method before it will adopt a recovered child. */
      async recover(task: unknown) {
        return runSession(task, true)
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => {
        if (!artifact) throw new Error(`session leaf ${label}: no terminal artifact`)
        return artifact
      },
    }
    return executor
  }

  // The recovery preparation: rebuild the interrupted child's spec around the SAME factory, so a
  // resumed process resolves the executor that re-attaches the session.
  const recoverable = registerRetainedExecutorPreparation(factory, ({ profile }) => ({
    spec: { profile, harness: null, executorFactory: factory } as AgentSpec,
    factory,
  }))

  return {
    makeLeafAgent: (profile) => {
      const spec: AgentSpec = { profile, harness: null, executorFactory: factory }
      return {
        name: profile.name ?? 'session',
        act: async () => undefined,
        executorSpec: spec,
      } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    },
    recoverExecutor: recoverable,
    stepLog: (p) => readLog(`${dir}/session-steps-${p}.log`),
    reattachLog: (p) => readLog(`${dir}/session-reattach-${p}.log`),
  }
}

export type { RetainedExecutorContext }
