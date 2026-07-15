/**
 * Auto-discover every reusable (vendor, fn, testFile, graderB64) sub-contract in blueprint-agent's
 * VB web-grounded API-integration leaves. Each grader is a self-contained mock+pytest that boots its
 * own mock and tests ONE exported function of the worker's solution.py — compose N of them into one
 * long-horizon integration (multi-contract-env). The fn is read from the decoded grader itself
 * (hasattr(module, "<fn>")), the ground truth, not guessed.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const VB = '/home/drew/code/blueprint-agent/scripts/experiments/scenarios/verticals/web-grounded'

// The HTTP-client-shaped API-integration files (composable: solution.py exports base_url/api_key fns).
const FILES = readdirSync(VB).filter((f) => (f.startsWith('api-') || f.startsWith('pipedrive')) && f.endsWith('.ts'))

function constVal(src, name) {
  const m = src.match(new RegExp(name + "\\s*=\\s*((?:'[^']*'\\s*\\+?\\s*)+)"))
  return m ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('') : null
}

const all = []
for (const file of FILES) {
  const src = readFileSync(join(VB, file), 'utf8')
  const vendor = (src.match(/partner:\s*'([^']+)'/) || src.match(/company:\s*'([^']+)'/) || [, file.replace(/\.ts$/, '')])[1]
  for (const call of src.matchAll(/oracleCommand\('([^']+)'\s*,\s*([A-Z0-9_]+)\)/g)) {
    const [, testFile, constName] = call
    const b64 = constVal(src, constName)
    if (!b64) { console.error('MISS b64', constName, file); continue }
    let grader
    try { grader = Buffer.from(b64, 'base64').toString('utf8') } catch { continue }
    const fn = grader.match(/hasattr\(module,\s*"([a-z_][a-z0-9_]*)"\)/)?.[1]
      ?? grader.match(/module\.([a-z_][a-z0-9_]*)\(/)?.[1]
    if (!fn) { console.error('MISS fn in grader', testFile, file); continue }
    // pull the signature from the grader's call or the seed
    const sig = (src.match(new RegExp('def ' + fn + '\\([^\\n)]*\\)[^\\n]*')) || [, `def ${fn}(base_url, api_key, ...)`])[0]
    all.push({ vendor: `${vendor}:${fn}`, fn, testFile, signature: (typeof sig === 'string' ? sig : `def ${fn}(base_url, api_key)`).trim(), graderB64: b64 })
    console.error('OK', vendor, fn, `(${testFile}, ${b64.length}b64)`)
  }
}

// dedup by fn (a solution.py exports each fn once) + keep GET-single-resource style first
const seen = new Set()
const contracts = all.filter((c) => (seen.has(c.fn) ? false : (seen.add(c.fn), true)))
const outDir = join(here, 'fixtures', 'multi-contract')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'contracts.all.json'), JSON.stringify(contracts, null, 2))
console.error(`\nDISCOVERED ${contracts.length} unique-fn contracts -> contracts.all.json`)
console.error('vendors:', contracts.map((c) => c.fn).join(', '))
