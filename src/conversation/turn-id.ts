/**
 *
 * Deterministic turn identifier. Stable across retries of the same logical
 * turn so backends (and any caching gateway in between) can dedupe on it.
 * A retry triggered by a network blip or deadline timeout MUST produce the
 * same `turn_id`; only the underlying attempt count differs.
 *
 * Shape: `${runId}.t${index}.${speakerSlug}` — readable in logs, sortable by
 * turn index, attributable to a speaker. Slugify keeps the speaker portion
 * URL-safe so it can ride in HTTP headers without escaping.
 *
 * @stable
 */

export function turnId(runId: string, index: number, speaker: string): string {
  return `${runId}.t${index}.${slugifySpeaker(speaker)}`
}

/**
 * Reduce a speaker name to ASCII alphanumerics + dashes. Preserves enough
 * substance to read in a log line; collisions between speakers within a
 * single Conversation are prevented by `defineConversation`'s
 * unique-name check, so the slug only needs to be deterministic, not unique.
 */
export function slugifySpeaker(speaker: string): string {
  const cleaned = speaker
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return cleaned || 'anon'
}
