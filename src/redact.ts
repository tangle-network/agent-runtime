/**
 *
 * Redaction for values that may leave the Runtime process. The default scrubs
 * common leak classes (API keys, bearer tokens, emails, private keys) from
 * strings and walks nested objects and arrays. A customer with domain-specific
 * PII supplies their own `redact` hook.
 *
 * This is intentionally narrower than `src/sanitize.ts` (which redacts the
 * runtime's *event envelope* field-by-field): here the value is opaque
 * customer payload, so the scrub is value-shaped, not schema-shaped.
 *
 * @experimental
 */

/** A redactor maps an arbitrary trace value to a safe-to-export value. Pure;
 *  must not throw on cyclic input (the default tolerates cycles). */
export type Redactor = (value: unknown) => unknown

const redactedMarker = '[redacted]'

/** Secret-bearing key names: when an object key matches, its value is fully
 *  replaced regardless of the value's own content. Lowercased compare. */
const secretKeyPattern =
  /(api[-_]?key|secret|token|password|passwd|authorization|auth|private[-_]?key|credential|access[-_]?key|client[-_]?secret|session[-_]?(id|token)|cookie|bearer)/i

/** In-value secret/PII patterns scrubbed from any string, regardless of key. */
const valuePatterns: ReadonlyArray<RegExp> = [
  // Bearer tokens.
  /\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi,
  // Provider-style API keys (sk-..., sk-tan-..., pk_live_..., ghp_...).
  /\b(?:sk|pk|rk|ak)[-_][A-Za-z0-9_-]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  // AWS access key ids.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // PEM private-key blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Email addresses.
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
]

/** Secret assignments embedded inside an otherwise opaque string, including
 * serialized JSON and log-style `key=value` text. */
const secretAssignmentPattern =
  /((?:"|')?(?:api[-_]?key|secret|token|password|passwd|authorization|auth|private[-_]?key|credential|access[-_]?key|client[-_]?secret|session[-_]?(?:id|token)|cookie|bearer)(?:"|')?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi

/** Scrub a single string of in-value secret/PII patterns. */
function scrubString(input: string): string {
  let out = input
  for (const pattern of valuePatterns) {
    out = out.replace(pattern, redactedMarker)
  }
  return out.replace(secretAssignmentPattern, `$1${redactedMarker}`)
}

/**
 * The built-in redactor. Walks objects and arrays; replaces values under
 * secret-bearing keys wholesale; scrubs in-value patterns from every string.
 * Cycle-safe (a seen-set short-circuits self-referential payloads to
 * `'[circular]'`), depth-bounded, and total — never throws on customer input.
 */
export function defaultRedactor(value: unknown): unknown {
  return walk(value, new WeakSet(), 0)
}

const maxDepth = 32

function walk(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > maxDepth) return '[truncated]'
  if (typeof value === 'string') return scrubString(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, seen, depth + 1))
  }

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (secretKeyPattern.test(key)) {
      out[key] = redactedMarker
      continue
    }
    out[key] = walk(v, seen, depth + 1)
  }
  return out
}

/** Stable identity input for saved work that depends on built-in redaction behavior. */
export function defaultRedactorIdentityMaterial(): unknown {
  const patternIdentity = (pattern: RegExp) => ({
    source: pattern.source,
    flags: pattern.flags,
  })
  return {
    marker: redactedMarker,
    secretKeyPattern: patternIdentity(secretKeyPattern),
    valuePatterns: valuePatterns.map(patternIdentity),
    secretAssignmentPattern: patternIdentity(secretAssignmentPattern),
    maxDepth,
    scrubString: Function.prototype.toString.call(scrubString),
    walk: Function.prototype.toString.call(walk),
    defaultRedactor: Function.prototype.toString.call(defaultRedactor),
  }
}

/**
 * Resolve the redactor a client uses. A caller-supplied hook handles
 * domain-specific values first, then the built-in scrubber still removes
 * common credentials and email addresses. Returning `false` is the explicit
 * opt-out for already-reviewed public values.
 */
export function resolveRedactor(redact: Redactor | false | undefined): Redactor {
  if (redact === false) return (value) => value
  if (!redact) return defaultRedactor
  return (value) => defaultRedactor(redact(value))
}
