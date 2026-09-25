/**
 * Redaction for values that may leave the Runtime process. The built-in
 * redactor is agent-eval's redaction core (`@tangle-network/agent-eval/traces`,
 * default profile): credentials found by field name or value shape are
 * replaced whole, email, card, SSN and phone values in place, and token counts
 * such as `inputTokens` or `max_tokens` are kept. A customer with
 * domain-specific PII supplies their own `redact` hook.
 *
 * This is narrower than `src/sanitize.ts`, which drops fields of the runtime's
 * *event envelope* unless the caller opts in: here the value is opaque customer
 * payload, so the scrub is value-shaped, not schema-shaped.
 *
 * @experimental
 */

import { REDACTION_VERSION, redact } from '@tangle-network/agent-eval/traces'

/** A redactor maps an arbitrary trace value to a safe-to-export value. Pure;
 *  must not throw on cyclic input (the default tolerates cycles). */
export type Redactor = (value: unknown) => unknown

/**
 * The built-in redactor. Cycle-safe, depth-bounded and total: it never throws
 * on customer input and never mutates it.
 */
export function defaultRedactor(value: unknown): unknown {
  return redact(value).value
}

/** Stable identity input for saved work that depends on built-in redaction behavior. */
export function defaultRedactorIdentityMaterial(): unknown {
  return { core: '@tangle-network/agent-eval/traces redact', profile: 'default', version: REDACTION_VERSION }
}

/**
 * Resolve the redactor a client uses. A caller-supplied hook handles
 * domain-specific values first, then the built-in scrubber still removes
 * credentials and personal data. Returning `false` is the explicit opt-out for
 * already-reviewed public values.
 */
export function resolveRedactor(redact: Redactor | false | undefined): Redactor {
  if (redact === false) return (value) => value
  if (!redact) return defaultRedactor
  return (value) => defaultRedactor(redact(value))
}
