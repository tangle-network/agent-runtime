/**
 * The ONE lint over model-authored source.
 *
 * Two features have a model write code the runtime then runs: `authorStrategy` (an authored
 * optimization strategy, since 0.60) and code mode's `execute` (a program over the coordination
 * verbs). Both need the same refusals; this module is the single copy both import.
 *
 * A LINT, NOT A SANDBOX — it reads text and cannot constrain what running code does, and trivial
 * concatenation defeats any token match. Its only job is refusing the obvious escapes so a typo or
 * a lazy model does not run; it is never the security boundary. Isolation, where required, is the
 * execution boundary's job (a jailed runner, a sandboxed loader), never this check's.
 */
import { ValidationError } from '../errors'

export interface AuthoredCodeOptions {
  /** Import specifiers an authored module may name. Empty (the default) bans every import. A
   *  specifier admits ANY import form of that module (named, namespace, default) — the lint
   *  gates WHICH module, not the syntax used to reach it. */
  readonly allowedImports?: ReadonlyArray<string>
  /** Names the refusal, e.g. `code mode (node-1)`. Defaults to `authored code`. */
  readonly context?: string
}

/** Refuse the obvious escapes in authored source. See the module doc for what this is NOT. */
export function assertAuthoredCode(code: string, options: AuthoredCodeOptions = {}): void {
  const context = options.context ?? 'authored code'
  const allowed = options.allowedImports ?? []
  for (const line of code.split('\n')) {
    if (!/^\s*import\s/.test(line)) continue
    const named = allowed.some(
      (specifier) => line.includes(`'${specifier}'`) || line.includes(`"${specifier}"`),
    )
    if (!named) {
      throw new ValidationError(
        `${context} rejected: foreign import — ${line.trim().slice(0, 120)}${
          allowed.length === 0
            ? ' (no import is allowed here)'
            : ` (allowed: ${allowed.join(', ')})`
        }`,
      )
    }
  }
  const banned: ReadonlyArray<readonly [RegExp, string]> = [
    [/\brequire\s*\(/, 'require()'],
    [/\bimport\s*\(/, 'dynamic import()'],
    [/\beval\s*\(/, 'eval()'],
    [/new\s+Function\s*\(/, 'new Function()'],
    [/\bprocess\s*[.[]/, 'process access'],
    [/\bglobalThis\s*[.[]/, 'globalThis access'],
    [/\bfetch\s*\(/, 'network access'],
    [/child_process|node:fs|node:net|node:http|worker_threads/, 'node builtin access'],
  ]
  for (const [pattern, what] of banned) {
    if (pattern.test(code)) throw new ValidationError(`${context} rejected: ${what}`)
  }
}
