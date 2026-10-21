import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'


/** Every installed `@tangle-network/*` directory, including nested copies. */
export function firstPartyPackageDirs(scopeDir) {
  const dirs = []
  for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const packageDir = join(scopeDir, entry.name)
    dirs.push(packageDir)
    const nestedScope = join(packageDir, 'node_modules', '@tangle-network')
    if (existsSync(nestedScope)) dirs.push(...firstPartyPackageDirs(nestedScope))
  }
  return dirs
}


export function ownJavascriptFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...ownJavascriptFiles(path))
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(path)
  }
  return files
}
