import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue

  const path = join(root, entry.name, 'SKILL.md')
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) continue
  skillCount += 1

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
