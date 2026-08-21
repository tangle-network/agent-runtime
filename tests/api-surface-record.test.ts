import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const roots: string[] = []

/** A built package with one entry point, whose declarations the test states. */
async function buildPackage(declarations: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-api-surface-'))
  roots.push(root)
  await mkdir(join(root, 'dist'))
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: '@tangle-network/fixture',
        version: '1.0.0',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      },
      null,
      2,
    )}\n`,
  )
  return rebuild(root, declarations)
}

/** Re-emit the entry point's declarations and re-read the record they produce. */
async function rebuild(root: string, declarations: string): Promise<string> {
  await writeFile(join(root, 'dist', 'index.d.ts'), declarations)
  return root
}

async function record(root: string): Promise<Record<string, string>> {
  await execFileAsync(process.execPath, ['scripts/check-api-surface.mjs', '--write'], {
    cwd: process.cwd(),
    env: { ...process.env, API_SURFACE_ROOT: root },
  })
  const written = JSON.parse(await readFile(join(root, 'api-surface.json'), 'utf8'))
  return written.entries['.']
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('the surface record states the shape behind each name', () => {
  it('moves the shape of a type that loses a field, and nothing else', async () => {
    const root = await buildPackage(
      [
        'interface WorkerView {',
        '  readonly id: string;',
        '  readonly cwd?: string;',
        '}',
        'interface TopSnapshot {',
        '  readonly workers: WorkerView[];',
        '}',
        'export { type TopSnapshot, type WorkerView };',
        '',
      ].join('\n'),
    )
    const before = await record(root)

    await rebuild(
      root,
      [
        'interface WorkerView {',
        '  readonly id: string;',
        '}',
        'interface TopSnapshot {',
        '  readonly workers: WorkerView[];',
        '}',
        'export { type TopSnapshot, type WorkerView };',
        '',
      ].join('\n'),
    )
    const after = await record(root)

    expect(after.WorkerView).not.toBe(before.WorkerView)
    // The name set is identical, which is why a name-only record called this
    // "surface unchanged".
    expect(Object.keys(after)).toEqual(Object.keys(before))
    // A referencing type names `WorkerView`, so the removal is reported once —
    // on the type that lost the field, not on everything that can reach it.
    expect(after.TopSnapshot).toBe(before.TopSnapshot)
  })

  it('moves the shape of a type whose union gains a member', async () => {
    const root = await buildPackage(
      [
        'interface PromotionVerdict {',
        "  readonly reason: 'not-cheaper' | 'non-inferior';",
        '}',
        'export { type PromotionVerdict };',
        '',
      ].join('\n'),
    )
    const before = await record(root)

    await rebuild(
      root,
      [
        'interface PromotionVerdict {',
        "  readonly reason: 'not-cheaper' | 'non-inferior' | 'cost-unknown';",
        '}',
        'export { type PromotionVerdict };',
        '',
      ].join('\n'),
    )
    const after = await record(root)

    expect(after.PromotionVerdict).not.toBe(before.PromotionVerdict)
  })

  it('holds the shape across a doc comment and a reformat', async () => {
    const root = await buildPackage(
      [
        'interface WorkerView {',
        '  readonly id: string;',
        '}',
        'export { type WorkerView };',
        '',
      ].join('\n'),
    )
    const before = await record(root)

    await rebuild(
      root,
      [
        '/** The worker as the operator view reads it. */',
        'interface WorkerView {',
        '  /** Stable across the run. */',
        '      readonly id: string;',
        '}',
        'export { type WorkerView };',
        '',
      ].join('\n'),
    )

    // A gate that reddens on a doc edit or a formatting change is a gate people
    // turn off, so neither may move the record.
    expect(await record(root)).toEqual(before)
  })

  it('holds the shape when the bundler renames the declaration it emits', async () => {
    const root = await buildPackage(
      [
        'interface WorkerView {',
        '  readonly id: string;',
        '}',
        'export { type WorkerView };',
        '',
      ].join('\n'),
    )
    const before = await record(root)

    // A second module declaring the same identifier makes the bundler suffix
    // one of them. The public name is unchanged, so the record must be too.
    await rebuild(
      root,
      [
        'interface WorkerView$1 {',
        '  readonly id: string;',
        '}',
        'export { type WorkerView$1 as WorkerView };',
        '',
      ].join('\n'),
    )

    expect(await record(root)).toEqual(before)
  })
})
