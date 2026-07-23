/**
 * Deterministic scrubbing pass over rollout-ledger lines before public release.
 *
 * Every rule is a pure regex rewrite applied to every string value in a line
 * (messages, artifacts, run ids, tool arguments — everywhere), so the scrubbed
 * line is still a valid `tangle.rollout.v1` line. Rules are idempotent:
 * scrub(scrub(x)) === scrub(x), and a second pass counts zero hits — that is
 * the property the release pipeline relies on to prove nothing half-scrubbed
 * ships. Rule order matters: whole `KEY=value` env pairs are redacted before
 * the bare-key rule so one secret is never counted twice.
 */

import type { RolloutLine } from '../types.ts'

export interface ScrubRule {
  name: string
  pattern: RegExp
  /** Rewrite for one match; `g1` is the first capture group when present. */
  rewrite: (match: string, g1?: string) => string
}

export const SCRUB_RULES: readonly ScrubRule[] = [
  {
    // /home/<user> and /Users/<user> prefixes → $WORK ($HOME-derived paths).
    name: 'home-path',
    pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+/g,
    rewrite: () => '$WORK',
  },
  {
    // Harness stores encode cwd as a dashed path segment (-home-drew-…);
    // strip the leading -home-<user> so the username never ships.
    name: 'home-path-encoded',
    pattern: /(?<=\/)-(?:home|Users)-[A-Za-z0-9_.]+/g,
    rewrite: () => '$WORK',
  },
  {
    // pytest names its tmpdir after the invoking user (/tmp/pytest-of-drew).
    name: 'tmp-user-dir',
    pattern: /\/tmp\/pytest-of-[A-Za-z0-9._-]+/g,
    rewrite: () => '/tmp/pytest-of-$USER',
  },
  {
    // `ls -l` owner/group columns leak the username in captured tool output.
    // The `(?!user user…)` guard keeps a second pass at zero rewrites.
    name: 'ls-owner',
    pattern: /([-bcdlps][-rwxsStT]{9}[.+@]?\s+\d+\s+)(?!user user(?=\s))[A-Za-z0-9._-]+\s+[A-Za-z0-9._-]+(?=\s)/g,
    rewrite: (_match, prefix) => `${prefix}user user`,
  },
  {
    // Env-var-shaped secrets: NAME=value where NAME looks credential-bearing.
    // The (?!\[REDACTED:) guard keeps the rule idempotent on its own output.
    name: 'env-secret',
    pattern: /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?))=(?!\[REDACTED:)("[^"]*"|'[^']*'|[^\s"']+)/g,
    rewrite: (_match, name) => `${name}=[REDACTED:env]`,
  },
  {
    name: 'bearer-token',
    pattern: /\b(Bearer|Basic)\s+(?!\[REDACTED:)[A-Za-z0-9\-._~+/=]{8,}/g,
    rewrite: (_match, scheme) => `${scheme} [REDACTED:bearer]`,
  },
  {
    // Bare provider-prefixed keys (OpenAI/Anthropic sk-, GitHub ghp_/gho_/…,
    // fine-grained PATs, HuggingFace hf_, Slack xox*, AWS AKIA).
    name: 'api-key',
    pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
    rewrite: () => '[REDACTED:api-key]',
  },
  {
    // Our infra hostnames → placeholder domain, subdomain preserved
    // (router.tangle.tools → router.internal.example).
    name: 'infra-host',
    pattern: /(?<![A-Za-z0-9.-])((?:[A-Za-z0-9-]+\.)*)tangle\.(?:tools|network)(?![A-Za-z0-9-])/g,
    rewrite: (_match, prefix) => `${prefix ?? ''}internal.example`,
  },
  {
    // Known workstation hostnames leak through email Message-IDs and fqdn
    // lookups inside captured test output; extend the list as machines join.
    name: 'machine-host',
    pattern: /\b[A-Za-z0-9]+-GTR-Pro\b/g,
    rewrite: () => 'workstation',
  },
]

/** Rule name → number of matches rewritten. Always carries every rule (0 is data). */
export type ScrubCounts = Record<string, number>

export function emptyScrubCounts(): ScrubCounts {
  return Object.fromEntries(SCRUB_RULES.map((rule) => [rule.name, 0]))
}

export function addScrubCounts(into: ScrubCounts, from: ScrubCounts): ScrubCounts {
  for (const [name, count] of Object.entries(from)) into[name] = (into[name] ?? 0) + count
  return into
}

export function scrubText(text: string, counts: ScrubCounts): string {
  let out = text
  for (const rule of SCRUB_RULES) {
    out = out.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      counts[rule.name] += 1
      return rule.rewrite(match, typeof rest[0] === 'string' ? rest[0] : undefined)
    })
  }
  return out
}

function scrubValue(value: unknown, counts: ScrubCounts): unknown {
  if (typeof value === 'string') return scrubText(value, counts)
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, counts))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = scrubValue(item, counts)
    return out
  }
  return value
}

/** Scrub every string value in a line; structure and key order are preserved. */
export function scrubRolloutLine(line: RolloutLine, counts: ScrubCounts): RolloutLine {
  return scrubValue(line, counts) as RolloutLine
}

export function scrubLines(lines: RolloutLine[]): { lines: RolloutLine[]; counts: ScrubCounts } {
  const counts = emptyScrubCounts()
  return { lines: lines.map((line) => scrubRolloutLine(line, counts)), counts }
}
