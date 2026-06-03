/**
 * @experimental
 *
 * Shared slug helper used by both the in-process auditor client (for
 * screenshot filenames) and the issue writer (for issue Markdown
 * filenames). Lowercases, normalizes, strips non-alphanumeric, trims
 * dashes, caps at 80 chars. Throws when the result is empty so callers
 * never silently write to a name-less filename.
 */

/** @experimental */
export function slugify(value: string, fieldName: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  if (slug.length === 0) {
    throw new Error(
      `ui-auditor: ${fieldName} slugified to empty string. Provide a non-empty value (got ${JSON.stringify(value)}).`,
    )
  }
  return slug
}
