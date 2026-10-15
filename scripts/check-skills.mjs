import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isIP } from 'node:net'
import { fileURLToPath } from 'node:url'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import { skillDirForHarness } from '@tangle-network/agent-profile-materialize'

const root = process.env.AGENT_RUNTIME_SKILLS_ROOT
  ? resolve(process.env.AGENT_RUNTIME_SKILLS_ROOT)
  : fileURLToPath(new URL('../skills/', import.meta.url))
const maxDescriptionChars = 96
const maxSkillBytes = 20_000
const errors = []
let descriptionChars = 0
let skillCount = 0

if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`skills directory is missing: ${root}`)
  process.exit(1)
}

function frontmatterField(frontmatter, key) {
  const lines = frontmatter.split('\n')
  const index = lines.findIndex((line) => line.startsWith(`${key}:`))
  if (index === -1) return undefined

  const value = lines[index].slice(key.length + 1).trim()
  if (!/^[>|][0-9+-]*$/.test(value)) return value.replace(/^["']|["']$/g, '')

  const continuation = []
  for (const line of lines.slice(index + 1)) {
    if (line && !/^\s/.test(line)) break
    continuation.push(line.trim())
  }
  return (value.startsWith('>') ? continuation.join(' ') : continuation.join('\n')).trim()
}

// Only this shipped template is generated; portable resource resolution stays materializer-owned.
function synchronizeManagerResources(profile, path, fail) {
  let resources
  try {
    const directory = skillDirForHarness(profile.harness)
    if (!directory) throw new Error('unsupported skill placement')
    const content = (source) => readFileSync(join(root, 'profile-authoring', source), 'utf8')
    resources = {
      failOnError: true,
      skills: [{ kind: 'inline', name: 'profile-authoring', content: content('SKILL.md') }],
      files: [
        { path: 'profiles/proxy-worker.json', resource: {
          kind: 'inline', name: 'proxy-worker', content: content('examples/proxy-worker.json'),
        } },
        { path: `${directory}/profile-authoring/references/execution-and-credentials.md`, resource: {
          kind: 'inline', name: 'execution-and-credentials', content: content('references/execution-and-credentials.md'),
        } },
      ],
    }
  } catch {
    fail('generated manager resources require maintained sources and a supported skill placement')
    return
  }
  if (JSON.stringify(profile.resources) === JSON.stringify(resources)) return
  if (!process.argv.includes('--write')) {
    fail('generated manager resources are stale; refresh with check:skills --write')
    return
  }
  profile.resources = resources
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`)
}

// This authoring policy requires explicit scope/lifetime in published examples.
// Portable schema validation and grant attenuation remain owned by agent-interface.
function checkProxyExamples(directory) {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const label = `profile-authoring/examples/${entry.name}`
    const fail = (message) => errors.push(`${label}: ${message}`)
    let profile
    try {
      profile = JSON.parse(readFileSync(join(directory, entry.name), 'utf8'))
    } catch {
      fail('profile must be valid JSON')
      continue
    }
    if (entry.name === 'proxy-manager.json') {
      synchronizeManagerResources(profile, join(directory, entry.name), fail)
    }
    if (!agentProfileSchema.safeParse(profile).success) {
      fail('profile failed canonical AgentProfile schema validation')
    }
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue
    if (profile.proxySecrets === undefined) continue
    if (!Array.isArray(profile.proxySecrets)) {
      fail('proxySecrets must be an array')
      continue
    }
    const names = new Set()
    const references = new Set()
    for (const binding of profile.proxySecrets) {
      if (!binding || typeof binding !== 'object') {
        fail('proxy binding must be an object')
        continue
      }
      if (typeof binding.envName !== 'string' || !binding.envName || names.has(binding.envName)) {
        fail('proxy bindings need distinct envName placeholders')
      }
      names.add(binding.envName)
      const ref = binding.secretRef
      if (!ref || ref.kind !== 'secret-ref' || typeof ref.key !== 'string' || !ref.key ||
          Object.keys(ref).some((key) => key !== 'kind' && key !== 'key')) {
        fail('use only an authorized secret-ref, without credential values')
      } else references.add(ref.key)
      const explicit = (values, accepts) => Array.isArray(values) && values.length > 0 && values.every(accepts)
      if (!explicit(binding.hosts, (host) => typeof host === 'string' &&
          host.includes('.') && !/[*:/@#\s]/.test(host) && !isIP(host))) {
        fail('declare exact hosts, without wildcards, addresses or ports')
      }
      if (!explicit(binding.methods, (method) => typeof method === 'string' && /^[A-Z]+$/.test(method))) {
        fail('declare explicit methods')
      }
      if (!explicit(binding.paths, (path) => typeof path === 'string' && path.startsWith('/') && !path.includes('*'))) {
        fail('declare explicit paths')
      }
      if (!Number.isSafeInteger(binding.ttlSeconds) || binding.ttlSeconds <= 0) {
        fail('declare a finite positive ttlSeconds within installed policy')
      }
      if (Array.isArray(binding.paths) && binding.paths.includes('/')) console.warn(`${label}: review broad root path scope`)
    }
    function readable(value) {
      if (!value || typeof value !== 'object') return
      if (value.kind === 'secret-ref' && references.has(value.key)) fail('readable duplicate of proxy-held reference')
      for (const [key, child] of Object.entries(value)) {
        if (key === 'env' && child && typeof child === 'object' &&
            Object.keys(child).some((name) => names.has(name))) fail('readable duplicate of proxy placeholder')
        readable(child)
      }
    }
    const { proxySecrets: _bindings, ...readableProfile } = profile
    readable(readableProfile)
  }
}

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue

  const path = join(root, entry.name, 'SKILL.md')
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) continue
  skillCount += 1
  if (entry.name === 'profile-authoring') checkProxyExamples(join(root, entry.name, 'examples'))

  const rawContent = readFileSync(path, 'utf8')
  const content = rawContent.replace(/\r\n?/g, '\n')
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]
  if (!frontmatter) {
    errors.push(`${entry.name}: missing YAML frontmatter`)
    continue
  }

  const name = frontmatterField(frontmatter, 'name')
  const description = frontmatterField(frontmatter, 'description')

  if (name !== entry.name) {
    errors.push(`${entry.name}: frontmatter name is ${JSON.stringify(name)}`)
  }
  if (!description) {
    errors.push(`${entry.name}: description is missing`)
  } else {
    descriptionChars += description.length
    if (description.length > maxDescriptionChars) {
      errors.push(
        `${entry.name}: description has ${description.length} chars; max is ${maxDescriptionChars}`,
      )
    }
  }
  if (Buffer.byteLength(rawContent) > maxSkillBytes) {
    errors.push(
      `${entry.name}: SKILL.md has ${Buffer.byteLength(rawContent)} bytes; max is ${maxSkillBytes}`,
    )
  }

  const footer = content.lastIndexOf('\n## Then consider\n')
  if (footer === -1 || content.indexOf('\n## ', footer + 1) !== -1) {
    errors.push(`${entry.name}: ## Then consider must be the final level-two section`)
  }
}

if (skillCount === 0) errors.push('no skills found')

if (errors.length > 0) {
  for (const error of errors) console.error(error)
  process.exitCode = 1
} else {
  console.log(`skills valid: ${descriptionChars} description chars`)
}
