import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A fresh temporary directory, named by its REAL path.
 *
 * macOS hands out temporary roots under `/var`, a symbolic link to `/private/var`. Git, the
 * Eval worktree adapter and the Knowledge transaction guard all report the RESOLVED spelling,
 * then compare it against the root the caller supplied. A fixture that keeps the `/var`
 * spelling therefore fails every containment check against a path those tools produced, and
 * the failure is invisible on Linux, where the two spellings are the same string.
 *
 * Resolve once, here, so no fixture repeats the rule and no comparison can see two spellings
 * of one directory.
 */
export function makeTempRoot(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)))
}
