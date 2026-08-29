/**
 *
 * The one reader for caller-supplied per-prompt sandbox SDK options.
 *
 * Both sandbox substrates — the round-synchronous `runAgentRounds` kernel and the steerable
 * `Scope`/`Supervisor` session — accept `promptOptions` on their execution context and forward it
 * into every `streamPrompt`. A host commonly puts a session-scoped credential there
 * (`backend.model.authMode` + `authFiles`), so a value the kernel cannot use must fail at the
 * boundary: a dropped credential surfaces much later as an auth failure inside the box, where it
 * reads as a platform fault rather than a caller error.
 *
 * `sessionId` and `signal` are kernel-owned. The static type excludes them, but a structural
 * `Omit` does not reject an object that carries them (a full `PromptOptions` is assignable to
 * `Omit<PromptOptions, 'signal' | 'sessionId'>`), and an untyped host — JSON on a wire, a JS
 * caller — is not type-checked at all. This reader removes both, so the kernel's own session id
 * and abort signal are the only ones that can reach the SDK.
 *
 * @experimental
 */

import type { PromptOptions } from '@tangle-network/sandbox'
import { ValidationError } from '../errors'

/** Keys the kernel owns on every prompt it sends; a caller value never carries them past here. */
const kernelOwnedPromptKeys = new Set(['sessionId', 'signal'])

/**
 * Validate and normalize a caller's `promptOptions`.
 *
 * @param value the raw value from the execution context.
 * @param where the field path to name in the error, e.g. `'runAgentRounds: ctx.promptOptions'`.
 * @returns the options minus the kernel-owned keys, or `undefined` when the caller supplied none.
 * @throws ValidationError when the value is present but is not a plain object.
 */
export function readPromptOptions(
  value: unknown,
  where: string,
): Omit<PromptOptions, 'signal' | 'sessionId'> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${where} must be an object of SDK PromptOptions`)
  }
  const owned: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (kernelOwnedPromptKeys.has(key)) continue
    owned[key] = entry
  }
  return owned as Omit<PromptOptions, 'signal' | 'sessionId'>
}

/** Per-prompt keys that choose the instrument: which harness runs the turn, on which credential,
 *  as which model. Checked in this order, so a value carrying both names the first one. */
export type InstrumentPromptKey = 'backend' | 'model'

const instrumentPromptKeys: readonly InstrumentPromptKey[] = ['backend', 'model']

/**
 * Refuse a per-prompt option a boxless `SandboxClient` seam cannot honor.
 *
 * These seams present an in-process executor as a box: there is no sandbox to reconfigure, so an
 * instrument key — `backend` (the harness to run and the credential to run it on) or `model` (the
 * id to serve the turn) — states an intent the seam can only drop. Dropping it would run the turn
 * on a different instrument than the caller asked for and report nothing, so it fails here
 * instead, before the prompt runs.
 *
 * Every other key stays accepted and ignored: `timeoutMs` and `context` shape how a box executes
 * a turn, not which instrument serves it, and an in-process executor answers on its own terms.
 *
 * What counts as a valid value is {@link readPromptOptions}, so a boxless seam holds a caller to
 * the same contract as the kernels: absent is fine, an object is read, anything else throws.
 *
 * @param options the per-prompt options the seam received.
 * @param seam the seam to name in the error, e.g. `'inlineSandboxClient'`.
 * @param keys the instrument keys this seam cannot honor. A seam that hands its per-prompt
 *   options to a caller-supplied callback passes only the keys the callback cannot act on.
 * @throws ValidationError when the options are not an object, or carry one of `keys`.
 */
export function assertBoxlessPromptOptions(
  options: unknown,
  seam: string,
  keys: readonly InstrumentPromptKey[] = instrumentPromptKeys,
): void {
  const supplied = readPromptOptions(options, `${seam}: promptOptions`)
  if (supplied === undefined) return
  for (const key of keys) {
    if (supplied[key] === undefined) continue
    throw new ValidationError(`${seam}: promptOptions.${key} cannot apply without a box`)
  }
}
