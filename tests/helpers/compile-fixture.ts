import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'tsdown'

/**
 * Compile one TypeScript child-process fixture to ESM once, so each child's deadline measures
 * Runtime execution rather than reloading the TypeScript source tree. Under publisher load,
 * per-process `--import tsx` compilation alone outlasted a 30 s child bound.
 */
export async function compileFixture(entry: string) {
  // Inside node_modules so the bundle resolves the repository's dependencies.
  const directory = await mkdtemp(join(resolve('node_modules'), '.runtime-fixture-'))
  await build({
    config: false,
    entry: { fixture: resolve(entry) },
    outDir: directory,
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: true,
    dts: false,
    sourcemap: false,
    deps: { neverBundle: true },
    logLevel: 'error',
  })
  return {
    path: join(directory, 'fixture.mjs'),
    dispose: () => rm(directory, { recursive: true, force: true }),
  }
}
