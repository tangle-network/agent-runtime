import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../skills/', import.meta.url)
const maxDescriptionChars = 96
const maxSkillBytes = 20_000
const errors = []
let descriptionChars = 0

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue

  const path = join(root.pathname, entry.name, 'SKILL.md')
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) continue

  const content = readFileSync(path, 'utf8')
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]
  if (!frontmatter) {
    errors.push(`${entry.name}: missing YAML frontmatter`)
    continue
  }

  const name = frontmatter.match(/^name:\s*["']?([^"'\n]+)["']?$/m)?.[1]
  const rawDescription = frontmatter.match(/^description:\s*(.+)$/m)?.[1]
  const description = rawDescription?.replace(/^["']|["']$/g, '')

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
  if (Buffer.byteLength(content) > maxSkillBytes) {
    errors.push(
      `${entry.name}: SKILL.md has ${Buffer.byteLength(content)} bytes; max is ${maxSkillBytes}`,
    )
  }

  const footer = content.lastIndexOf('\n## Then consider\n')
  if (footer === -1 || content.indexOf('\n## ', footer + 1) !== -1) {
    errors.push(`${entry.name}: ## Then consider must be the final level-two section`)
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error)
  process.exitCode = 1
} else {
  console.log(`skills valid: ${descriptionChars} description chars`)
}
