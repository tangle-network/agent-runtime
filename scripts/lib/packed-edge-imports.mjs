import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { findLiteralModuleSpecifiers, findStaticPackageImports } from './static-imports.mjs'
import { firstPartyPackageDirs, ownJavascriptFiles } from './first-party-package-tree.mjs'

// Static imports of these packages mutate Node builtins at module load and can
// make edge runtimes reject a Worker before startup. Scan installed first-party
// output because Runtime can inherit the failure through a transitive package.
const edgeUnsafeStaticImports = ['graceful-fs', 'proper-lockfile']


export function assertNoEdgeUnsafeStaticImports(scopeDir) {
  if (!existsSync(scopeDir)) throw new Error(`expected an installed scope at ${scopeDir}`)
  const packageDirs = firstPartyPackageDirs(scopeDir)
  if (packageDirs.length === 0) throw new Error(`no @tangle-network packages installed at ${scopeDir}`)
  const offenders = []
  let scanned = 0
  for (const packageDir of packageDirs) {
    // Third-party package bodies are outside this first-party artifact check.
    for (const file of ownJavascriptFiles(packageDir)) {
      scanned += 1
      const source = readFileSync(file, 'utf8')
      for (const specifier of findStaticPackageImports(source, edgeUnsafeStaticImports, file)) {
        offenders.push(`${file.slice(scopeDir.length + 1)} -> ${specifier}`)
      }
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      [
        'an installed @tangle-network package statically imports a module that patches a Node builtin.',
        'Cloudflare rejects the whole Worker on upload with code 10021, and a dry run cannot see it.',
        'Fix it in the owning package with a dynamic import() inside the function that needs it.',
        ...offenders.map((offender) => `  - ${offender}`),
      ].join('\n'),
    )
  }
  process.stdout.write(
    `Edge module-load safety: ${packageDirs.length} first-party packages, ${scanned} shipped files, no blocked static imports.\n`,
  )
}


export function staticExternalImportClosure(entryPath, packageDir) {
  const queue = [resolve(entryPath)]
  const visited = new Set()
  const externalImports = new Set()

  while (queue.length > 0) {
    const file = queue.pop()
    if (visited.has(file)) continue
    visited.add(file)

    const source = readFileSync(file, 'utf8')
    for (const specifier of findLiteralModuleSpecifiers(source, file)) {
      if (!specifier.startsWith('.')) {
        externalImports.add(specifier)
        continue
      }

      const importedFile = resolve(dirname(file), specifier)
      const packageRelativePath = relative(packageDir, importedFile)
      if (packageRelativePath.startsWith('..') || isAbsolute(packageRelativePath)) {
        throw new Error(`tool-loop import escapes the packed package: ${specifier}`)
      }
      if (!existsSync(importedFile)) {
        throw new Error(`tool-loop import is missing from the packed package: ${specifier}`)
      }
      queue.push(importedFile)
    }
  }

  return [...externalImports].sort()
}
