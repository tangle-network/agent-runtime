import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-skills-'))
  roots.push(root)
  return root
}

async function writeSkill(root: string, name: string, content: string): Promise<void> {
  const directory = join(root, name)
  await mkdir(directory)
  await writeFile(join(directory, 'SKILL.md'), content)
}

async function check(root: string) {
  return execFileAsync(process.execPath, ['scripts/check-skills.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, AGENT_RUNTIME_SKILLS_ROOT: root },
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('skill package check', () => {
  it('accepts valid CRLF frontmatter', async () => {
    const root = await createRoot()
    await writeSkill(
      root,
      'valid',
      [
        '---',
        'name: valid',
        'description: A compact test skill.',
        '---',
        '',
        '# Valid',
        '',
        '## Then consider',
        '',
        '- `verify` before release.',
        '',
      ].join('\r\n'),
    )

    await expect(check(root)).resolves.toMatchObject({ stderr: '' })
  })

  it('rejects an empty skills directory', async () => {
    const root = await createRoot()
    await expect(check(root)).rejects.toMatchObject({
      stderr: expect.stringContaining('no skills'),
    })
  })

  it('rejects a missing skills directory', async () => {
    const root = await createRoot()
    await rm(root, { recursive: true })

    await expect(check(root)).rejects.toMatchObject({
      stderr: expect.stringContaining('skills directory is missing'),
    })
  })

  it.each([
    ['wrong name', 'name: different', 'frontmatter name'],
    ['long description', `description: ${'x'.repeat(97)}`, 'description has 97 chars'],
    ['folded long description', `description: >-\n  ${'x'.repeat(97)}`, 'description has 97 chars'],
    [
      'misplaced footer',
      '## Then consider\n\n- `verify` before release.\n\n## Later',
      'final level-two section',
    ],
  ])('rejects %s', async (_label, mutation, expected) => {
    const root = await createRoot()
    let content = [
      '---',
      'name: invalid',
      'description: A compact test skill.',
      '---',
      '',
      '# Invalid',
      '',
      '## Then consider',
      '',
      '- `verify` before release.',
      '',
    ].join('\n')
    if (mutation.startsWith('name:')) content = content.replace('name: invalid', mutation)
    else if (mutation.startsWith('description:')) {
      content = content.replace('description: A compact test skill.', mutation)
    } else content = content.replace('## Then consider\n\n- `verify` before release.', mutation)
    await writeSkill(root, 'invalid', content)

    await expect(check(root)).rejects.toMatchObject({ stderr: expect.stringContaining(expected) })
  })
})
