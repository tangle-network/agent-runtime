import { tmpdir } from 'node:os'
import { isAbsolute } from 'node:path'

/** Docker bind mounts and mkdtemp parents must never inherit a relative operating-system temp root. */
export function absoluteSweTempDir(): string {
  const dir = tmpdir()
  if (!isAbsolute(dir)) {
    throw new Error(
      `SWE temporary directory must be absolute, got "${dir}"; ` +
        'TEMP configures the operating-system temp root, not model temperature. Use TEMPERATURE instead.',
    )
  }
  return dir
}
