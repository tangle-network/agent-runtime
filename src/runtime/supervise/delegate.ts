/**
 * Delegate one intent through an explicitly authored supervisor profile.
 *
 * This is a convenience call over `supervise`; it does not author a profile, choose a model,
 * choose execution backends, or set budget and tree policy on the caller's behalf.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ConfigError } from '../../errors'
import { type SuperviseOptions, supervise } from './supervise'
import type { SupervisedResult } from './types'

export interface DelegateOptions extends SuperviseOptions {
  readonly profile: AgentProfile
}

/** Delegate an intent without changing any caller-authored execution decision. */
export async function delegate<Out = unknown>(
  intent: string,
  opts: DelegateOptions,
): Promise<SupervisedResult<Out>> {
  if (typeof intent !== 'string' || intent.trim().length === 0) {
    throw new ConfigError('delegate: `intent` must be a non-empty string')
  }

  const { profile, ...superviseOptions } = opts
  return supervise(profile, intent, superviseOptions) as Promise<SupervisedResult<Out>>
}
