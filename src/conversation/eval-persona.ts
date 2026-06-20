/**
 * `evalPersona` — the one-call user-sim product eval. Run a worker `AgentProfile` (the agent under
 * test) against a PERSONA (a simulated user — a scripted script or an LLM driver profile) as a
 * multi-round conversation, with the two seams `runPersonaConversation` otherwise makes you hand-wire
 * defaulted:
 *
 *  - `backendFor` defaults to `createOpenAICompatibleBackend({ apiKey, baseUrl, model })` (the
 *    OpenAI-compatible router endpoint) for both the worker and a profile-driven persona;
 *  - `systemPromptOf` defaults to `p.prompt?.systemPrompt ?? ''`.
 *
 * Either is overridable (tests pass a fake `backendFor` to run offline). `maxTurns` (the hard
 * ceiling) and `haltOn` (the "until satisfied" early stop) pass straight through. Mirrors
 * `supervise()`'s defaulting style: the common case is one call; the raw `runPersonaConversation`
 * seam stays available for full control.
 *
 * The profile here is the authored `AgentProfile` (with `prompt.systemPrompt`), which is why the
 * default `systemPromptOf` can read it. `runPersonaConversation` treats the profile opaquely — only
 * the two callbacks inspect it — so the worker/persona profiles flow straight through.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { createOpenAICompatibleBackend } from '../backends'
import type { AgentExecutionBackend } from '../types'
import {
  type PersonaConversationResult,
  type PersonaDriver,
  runPersonaConversation,
} from './run-persona'
import type { HaltPredicate } from './types'

export interface EvalPersonaOptions {
  /** Router (or OpenAI-compatible) endpoint for the DEFAULT backend. Required unless `backendFor`
   *  is supplied (tests/advanced override the backend entirely and may omit these). */
  apiKey?: string
  baseUrl?: string
  model?: string
  /** Override the backend seam directly instead of deriving it from `apiKey`/`baseUrl`/`model`
   *  (the offline-test path: pass a fake here and the credentials are not needed). */
  backendFor?: (profile: AgentProfile, role: 'worker' | 'persona') => AgentExecutionBackend
  /** Override system-prompt rendering. Default: `p.prompt?.systemPrompt ?? ''`. */
  systemPromptOf?: (profile: AgentProfile) => string
  /** Hard speaker-turn ceiling. REQUIRED for a profile-driven persona; for a scripted persona it
   *  defaults to `2 * turns.length`. `maxTurns` is a CEILING, NOT a target — `maxTurns: 0` is zero
   *  turns, not run-until-done; `haltOn` is the "until satisfied" knob. */
  maxTurns?: number
  /** Content-based early stop (the persona declares the goal met / unreachable). */
  haltOn?: HaltPredicate
  /** Kickoff message to the persona. Default 'Begin.' */
  seed?: string
  signal?: AbortSignal
  /** Worker transcript speaker label. Default 'agent'. */
  workerName?: string
}

/** The persona side, authored against the same `AgentProfile` shape as the worker. */
export type EvalPersona =
  | { kind: 'scripted'; turns: string[] }
  | { kind: 'profile'; profile: AgentProfile }

export function evalPersona(
  worker: AgentProfile,
  persona: EvalPersona,
  opts: EvalPersonaOptions = {},
): Promise<PersonaConversationResult> {
  const defaultBackendFor = (): ((
    profile: AgentProfile,
    role: 'worker' | 'persona',
  ) => AgentExecutionBackend) => {
    if (!opts.apiKey || !opts.baseUrl || !opts.model) {
      throw new Error(
        'evalPersona: provide opts.{apiKey,baseUrl,model} for the default backend, or opts.backendFor',
      )
    }
    const { apiKey, baseUrl, model } = opts
    return () => createOpenAICompatibleBackend({ apiKey, baseUrl, model })
  }
  const backendFor = opts.backendFor ?? defaultBackendFor()

  const systemPromptOf = opts.systemPromptOf ?? ((p: AgentProfile) => p.prompt?.systemPrompt ?? '')

  return runPersonaConversation({
    // runPersonaConversation types its profile as the benchmark-cell AgentProfile; here it is the
    // authored AgentProfile (the carrier of prompt.systemPrompt). The runner never inspects the
    // profile itself — only backendFor/systemPromptOf do, and both are typed for THIS profile — so
    // the cast at this single boundary is sound.
    worker: worker as never,
    persona: persona as PersonaDriver,
    backendFor: backendFor as never,
    systemPromptOf: systemPromptOf as never,
    ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
    ...(opts.haltOn ? { haltOn: opts.haltOn } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.workerName !== undefined ? { workerName: opts.workerName } : {}),
  })
}
