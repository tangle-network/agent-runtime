import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execute = promisify(execFile)

it('refuses exact chat and optimizer transports without response model evidence before dispatch', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'runtime-chat-transport-'))
  try {
    await execute('git', ['init', '-q', '--initial-branch=main', repository])
    await execute('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: repository })
    await writeFile(
      join(repository, 'task.txt'),
      'An ordinary native worktree may still run here.\n',
    )
    await execute('git', ['add', 'task.txt'], { cwd: repository })
    await execute(
      'git',
      [
        '-c',
        'user.name=Runtime Integration',
        '-c',
        'user.email=runtime@example.invalid',
        'commit',
        '-qm',
        'fixture',
      ],
      { cwd: repository },
    )
    const { stdout, stderr } = await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve('tests/integration/fixtures/profile-chat-transport-admission.mjs'),
        repository,
      ],
      { cwd: resolve('.'), timeout: 20_000 },
    )
    const result = JSON.parse(stdout)
    expect(stderr).toBe('')
    expect(result.admission).toHaveLength(10)
    for (const row of result.admission) {
      expect(row.error, `${row.name}/${row.adapter} must refuse at construction`).toMatch(
        /cannot provide the response model evidence required by exact profile chat/,
      )
    }
    expect(result.supported).toEqual([
      { name: 'bridge', adapter: 'chat' },
      { name: 'bridge', adapter: 'optimizer' },
      { name: 'router', adapter: 'chat' },
      { name: 'router', adapter: 'optimizer' },
    ])
    expect(result.nativeBudgetExempt).toBe(false)
    expect(result.after).toBe(result.before)
    const status = await execute('git', ['status', '--porcelain'], { cwd: repository })
    expect(status.stdout).toBe('')
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})
