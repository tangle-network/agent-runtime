// The release scripts' one read of the npm registry for an exact version. `absent` is only a
// definite 404; any other answer or a failed request throws "could not read", so no caller can
// take an unreachable registry for a free or a missing version.
// Publication targets the public registry, so the read does too; an ambient npm registry setting
// cannot point it at a mirror that has not seen a version yet.
const PUBLIC_REGISTRY = 'https://registry.npmjs.org'

export async function readRegistryVersion(name, version, { registry = PUBLIC_REGISTRY, timeoutMs = 15_000 } = {}) {
  const url = `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new Error(`could not read the npm registry for ${name}@${version}: ${error.message}`, { cause: error })
  }
  if (response.status === 404) return { status: 'absent' }
  if (!response.ok) {
    throw new Error(`could not read the npm registry for ${name}@${version}: HTTP ${response.status}`, {
      cause: response.status,
    })
  }
  return { status: 'present', metadata: await response.json() }
}

const ARCHIVE_404 = /404 Not Found - GET (\S+\.tgz)/u

/** The package and version an npm archive URL names, or undefined. */
export function archiveIdentity(archiveUrl) {
  let url
  try {
    url = new URL(archiveUrl)
  } catch {
    return undefined
  }
  const marker = url.pathname.indexOf('/-/')
  if (marker <= 1) return undefined
  const name = decodeURIComponent(url.pathname.slice(1, marker))
  const file = url.pathname.slice(marker + 3)
  const prefix = `${name.split('/').pop()}-`
  if (!file.startsWith(prefix) || !file.endsWith('.tgz')) return undefined
  return { name, version: file.slice(prefix.length, -'.tgz'.length), registry: url.origin }
}

/**
 * Run an npm install, and wait out registry propagation: when npm fails on an archive 404 for a
 * version the registry already lists, the archive was published moments ago and is still reaching
 * the registry's edge (cli-agent-registry 0.15.176 answered 404 2.5 min after its publish and 200
 * two minutes later, 2026-11-23). An unlisted version fails at once; a listed one fails, named,
 * when the window ends.
 */
export async function installAcrossPropagation(
  install,
  { windowMs = 300_000, intervalMs = 15_000, log = (line) => console.error(line) } = {},
) {
  const deadline = Date.now() + windowMs
  for (;;) {
    try {
      return install()
    } catch (error) {
      const archive = String(error?.message ?? '').match(ARCHIVE_404)?.[1]
      const target = archive === undefined ? undefined : archiveIdentity(archive)
      if (target === undefined) throw error
      const record = await readRegistryVersion(target.name, target.version, { registry: target.registry })
      if (record.status !== 'present') throw error
      if (Date.now() + intervalMs > deadline) {
        throw new Error(
          `${target.name}@${target.version} is listed on the npm registry but its archive still answered 404 after ${Math.round(windowMs / 1000)} s`,
          { cause: error },
        )
      }
      log(`npm install: ${target.name}@${target.version} is listed but its archive answered 404; retrying in ${Math.round(intervalMs / 1000)} s`)
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
}
