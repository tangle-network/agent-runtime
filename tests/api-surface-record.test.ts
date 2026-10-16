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

describe('class declarations retain consumer-visible inheritance and members', () => {
  it.each([
    ['a public method', 'read(): string;', 'read(): number;'],
    ['a protected member', 'protected path: string;', 'protected path: number;'],
    ['a private brand', 'private brand;', ''],
    ['an inherited constructor', 'constructor(path: string);', 'constructor(path: number);'],
  ])('follows an unexported superclass when %s changes', async (_label, before, after) => {
    const declarations = (member: string) =>
      `declare class Base { ${member} } export declare class Child extends Base {}`
    const root = await buildPackage(declarations(before))
    const original = await record(root)
    await rebuild(root, declarations(after))
    expect((await record(root)).Child).not.toBe(original.Child)
  })

  it('ignores a bundler rename of an unexported superclass', async () => {
    const root = await buildPackage(
      'declare class Base { read(): string; } export declare class Child extends Base {}',
    )
    const before = await record(root)
    await rebuild(
      root,
      'declare class Base$1 { read(): string; } export declare class Child extends Base$1 {}',
    )
    expect(await record(root)).toEqual(before)
  })

  it('reports a published superclass change on its own record line', async () => {
    const declarations = (type: string) =>
      `export declare class Base { read(): ${type}; } export declare class Child extends Base {}`
    const root = await buildPackage(declarations('string'))
    const before = await record(root)
    await rebuild(root, declarations('number'))
    const after = await record(root)
    expect(after.Base).not.toBe(before.Base)
    expect(after.Child).toBe(before.Child)
  })

  it('follows an aliased superclass through relative re-exports', async () => {
    const root = await buildPackage(
      'import { Base as Local } from "./bridge.js"; export declare class Child extends Local {}',
    )
    await writeFile(
      join(root, 'dist', 'bridge.d.ts'),
      'export { Original as Base } from "./base.js";',
    )
    const base = join(root, 'dist', 'base.d.ts')
    await writeFile(base, 'export declare class Original { read(): string; }')
    const before = await record(root)
    await writeFile(base, 'export declare class Original { read(): number; }')
    expect((await record(root)).Child).not.toBe(before.Child)
  })

  it('follows a namespace-qualified superclass', async () => {
    const declarations = (type: string) =>
      `declare namespace Internal { class Base { read(): ${type}; } }
       export declare class Child extends Internal.Base {}`
    const root = await buildPackage(declarations('string'))
    const before = await record(root)
    await rebuild(root, declarations('number'))
    expect((await record(root)).Child).not.toBe(before.Child)
  })

  it('terminates a recursive superclass graph without hiding a reachable change', async () => {
    const declarations = (type: string, base = 'Base') =>
      `declare class ${base} { next?: Child; }
       declare class Child extends ${base} { value: ${type}; }
       export declare function create(): Child;`
    const root = await buildPackage(declarations('string'))
    const before = await record(root)
    await rebuild(root, declarations('string', 'Base$1'))
    expect(await record(root)).toEqual(before)
    await rebuild(root, declarations('number'))
    expect((await record(root)).create).not.toBe(before.create)
  })

  it.each([
    [
      'a private helper with another brand remaining',
      'private retained; private helper;',
      'private retained;',
    ],
    ['the last private brand', 'private brand;', ''],
    ['the ECMAScript private brand', '#private;', ''],
    ['a public readonly field', 'readonly path: string;', ''],
    ['a protected member', 'protected path: string;', 'protected path: number;'],
    ['constructor accessibility', 'constructor();', 'private constructor();'],
    ['protected constructor accessibility', 'constructor();', 'protected constructor();'],
    [
      'constructor overloads',
      'constructor(x: string); constructor(x: number);',
      'constructor(x: string);',
    ],
    [
      'method overloads',
      'read(x: string): string; read(x: number): number;',
      'read(x: string): string;',
    ],
  ])('still detects changes to %s', async (_label, before, after) => {
    const root = await buildPackage(`export declare class Public { ${before} }`)
    const original = await record(root)
    await rebuild(root, `export declare class Public { ${after} }`)
    expect((await record(root)).Public).not.toBe(original.Public)
  })
})

describe('literal content is part of a declaration shape', () => {
  it.each([
    ['string spaces', '"a b"', '"a  b"'],
    ['string tabs', '"a b"', '"a\tb"'],
    ['template prefix', `\`a \${string} b\``, `\`a  \${string} b\``],
    ['template suffix', `\`a \${string} b\``, `\`a \${string}  b\``],
    ['template newline', '`a b`', '`a\nb`'],
    ['nested templates', `\`a \${\`b \${string}\`} c\``, `\`a \${\`b  \${string}\`} c\``],
    ['literal interpolation', `\`a \${"b c"} d\``, `\`a \${"b  c"} d\``],
  ])('detects changed %s', async (_label, before, after) => {
    const root = await buildPackage(`export type Value = ${before};`)
    const original = await record(root)
    await rebuild(root, `export type Value = ${after};`)
    expect((await record(root)).Value).not.toBe(original.Value)
  })

  it('preserves literal whitespace while ignoring surrounding comments and formatting', async () => {
    const root = await buildPackage(
      `export type Value = "a  /*literal*/ b" | \`c  \${string}  d\`;`,
    )
    const before = await record(root)
    await rebuild(
      root,
      `/** comment */ export type Value =\n  "a  /*literal*/ b" /** another */ |\n  \`c  \${string}  d\`;`,
    )
    expect(await record(root)).toEqual(before)
  })

  it('still resolves renamed types and changes inside template interpolations', async () => {
    const declarations = (name: string, value: string) =>
      `type ${name} = "${value}"; export type Value = \`prefix  \${${name}}  suffix\`;`
    const root = await buildPackage(declarations('Hidden', 'a'))
    const before = await record(root)
    await rebuild(root, declarations('Hidden$1', 'a'))
    expect(await record(root)).toEqual(before)
    await rebuild(root, declarations('Hidden$1', 'b'))
    expect((await record(root)).Value).not.toBe(before.Value)
  })

  it('still distinguishes removed exports and value-to-type narrowing', async () => {
    const root = await buildPackage(
      'declare class Public {} export { Public }; export type Gone = string;',
    )
    const before = await record(root)
    await rebuild(root, 'declare class Public {} export type { Public };')
    const after = await record(root)
    expect(after.Gone).toBeUndefined()
    expect(before.Public).toMatch(/^value /)
    expect(after.Public).toMatch(/^type /)
  })
})
