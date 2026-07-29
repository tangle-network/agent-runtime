import assert from 'node:assert/strict'

import {
  findLiteralModuleSpecifiers,
  findStaticModuleSpecifiers,
  findStaticPackageImports,
} from './lib/static-imports.mjs'

const specifier = 'proper-lockfile'
const cases = [
  ['bound ESM import', `import value from '${specifier}'`, true],
  ['bare side-effect ESM import', `import '${specifier}'`, true],
  ['commented bare ESM import', `import/* retained comment */'${specifier}'`, true],
  ['commented bound ESM import', `import value from/* retained comment */'${specifier}'`, true],
  ['ESM re-export', `export { value } from '${specifier}'`, true],
  ['package subpath', `export * from '${specifier}/lib/lockfile.js'`, true],
  ['spaced CommonJS require', `require ('${specifier}')`, true],
  ['commented CommonJS require', `require/* retained comment */('${specifier}')`, true],
  ['module CommonJS require', `module.require('${specifier}')`, true],
  ['template CommonJS require', `require(\`${specifier}\`)`, true],
  ['dynamic import', `await import('${specifier}')`, false],
  ['commented dynamic import', `await import/* retained comment */('${specifier}')`, false],
  ['lookalike package', `import value from '${specifier}-safe'`, false],
  ['line comment', `// import '${specifier}'`, false],
  ['block comment', `/* require('${specifier}') */`, false],
  ['string literal', `const docs = "import '${specifier}'"`, false],
  ['template literal', `const docs = \`require('${specifier}')\``, false],
  ['unrelated member require', `loader.require('${specifier}')`, false],
  ['non-literal require', `require(packageName)`, false],
]

for (const [label, source, expected] of cases) {
  const actual = findStaticPackageImports(source, [specifier]).includes(specifier)
  assert.equal(actual, expected, label)
}

assert.deepEqual(
  findStaticPackageImports(
    `import 'graceful-fs'; await import('${specifier}')`,
    ['graceful-fs', specifier],
  ),
  ['graceful-fs'],
  'returns only statically imported blocked packages',
)

assert.deepEqual(
  findStaticModuleSpecifiers(
    `import './chunk.js'; export * from 'edge-safe-package'; await import('lazy-package')`,
  ),
  ['./chunk.js', 'edge-safe-package'],
  'returns every static module specifier and excludes dynamic imports',
)

assert.deepEqual(
  findLiteralModuleSpecifiers(
    `import './chunk.js'; await import('lazy-package'); import(variableName)`,
  ),
  ['./chunk.js', 'lazy-package'],
  'returns literal dynamic imports but excludes computed imports',
)

process.stdout.write(`Static import parser: ${cases.length + 3} synthetic cases passed.\n`)
