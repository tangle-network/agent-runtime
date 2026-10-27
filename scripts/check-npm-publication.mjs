import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// The qualified archive owns identity and bytes. Only a definite registry 404
// admits hosted publishing; retries verify the already served archive here.
const [directory] = process.argv.slice(2)
const packages = readdirSync(directory).filter((file) => file.endsWith('.tgz'))
if (packages.length !== 1) throw new Error('Expected exactly one qualified npm archive')
const archive = join(directory, packages[0])
const { name, version } = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }))
if (typeof name !== 'string' || typeof version !== 'string') throw new Error('Archive identity is missing')
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(15000) })
let pending
if (response.status === 404) {
  // verify-release-line.mjs, run from main, already required a superseded line's named consumer.
  execFileSync(process.execPath, ['scripts/check-version-bump.mjs', '--archive', archive, '--consumer', 'its CHANGELOG'], { stdio: 'inherit' })
  pending = true
} else {
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
  const metadata = await response.json()
  const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`
  if (!metadata.dist?.integrity?.split(/\s+/).includes(integrity)) throw new Error('Published npm archive differs from the qualified bytes')
  pending = false
}
appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending}\n`)
