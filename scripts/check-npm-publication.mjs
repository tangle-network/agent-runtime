import { appendFileSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// The qualified archive owns identity and bytes. Only a definite registry 404
// admits hosted publishing; retries verify the already served archive here.
const [directory, mode] = process.argv.slice(2)
if (mode && mode !== '--require-published') throw new Error('Unknown publication mode')
async function checkPublication() {
  const packages = readdirSync(directory).filter((file) => file.endsWith('.tgz'))
  if (packages.length !== 1) throw new Error('Expected exactly one qualified npm archive')
  const archive = join(directory, packages[0])
  if (mode && createHash('sha256').update(readFileSync(archive)).digest('hex') !== process.env.EXPECTED_SHA256) throw new Error('Qualified archive digest mismatch')
  const { name, version } = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }))
  if (typeof name !== 'string' || typeof version !== 'string') throw new Error('Archive identity is missing')
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(15000) })
  let pending
  if (response.status === 404) {
    if (mode === '--require-published') throw new Error('npm registry returned HTTP 404', { cause: 404 })
    // verify-release-line.mjs, run from main, already required a superseded line's named consumer.
    execFileSync(process.execPath, ['scripts/check-version-bump.mjs', '--archive', archive, '--consumer', 'its CHANGELOG'], { stdio: 'inherit' })
    pending = true
  } else {
    if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
    const metadata = await response.json()
    const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`
    if (!metadata.dist?.integrity?.split(/\s+/).includes(integrity)) throw new Error('Published npm archive differs from the qualified bytes')
    if (typeof metadata.dist?.tarball !== 'string') throw new Error('npm metadata lacks its advertised archive')
    const publicArchive = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(15000) })
    if (!publicArchive.ok) throw new Error(`npm archive returned HTTP ${publicArchive.status}`, { cause: publicArchive.status })
    const actual = `sha512-${createHash('sha512').update(Buffer.from(await publicArchive.arrayBuffer())).digest('base64')}`
    if (actual !== integrity) throw new Error('Advertised npm archive differs from the qualified bytes')
    pending = false
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending}\n`)
}
await checkPublication().catch((error) => {
  console.error(error)
  process.exitCode = mode && error.cause === 404 ? 3 : 1
})
