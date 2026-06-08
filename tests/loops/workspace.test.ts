import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitWorkspace } from '../../src/runtime/workspace'

const git = (args: string[], cwd?: string): string =>
  execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { cwd, encoding: 'utf-8', stdio: 'pipe' },
  )

function seedBare(): string {
  const bare = `${mkdtempSync(join(tmpdir(), 'ws-bare-'))}.git`
  git(['init', '--bare', '-b', 'main', bare])
  const seed = mkdtempSync(join(tmpdir(), 'ws-seed-'))
  git(['clone', bare, seed])
  writeFileSync(join(seed, 'seed.txt'), 'base\n')
  git(['add', '-A'], seed)
  git(['commit', '-m', 'seed'], seed)
  git(['push', 'origin', 'main'], seed)
  rmSync(seed, { recursive: true, force: true })
  return bare
}

describe('gitWorkspace', () => {
  let bare: string
  const temps: string[] = []
  const fresh = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-work-'))
    temps.push(dir)
    return dir
  }

  beforeEach(() => {
    bare = seedBare()
  })

  afterEach(() => {
    rmSync(bare, { recursive: true, force: true })
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('carries durable state across fresh worker filesystems', async () => {
    const ws = gitWorkspace({ ref: bare })
    const w1 = fresh()
    await ws.materialize(w1)
    writeFileSync(join(w1, 'a.txt'), 'one\n')
    expect(await ws.commit(w1, 'add a')).toMatchObject({ ok: true })

    const w2 = fresh()
    await ws.materialize(w2)
    expect(existsSync(join(w2, 'a.txt'))).toBe(true)
    expect(readFileSync(join(w2, 'a.txt'), 'utf-8')).toBe('one\n')
  })

  it('returns a typed conflict instead of overwriting concurrent edits', async () => {
    const ws = gitWorkspace({ ref: bare })
    const w1 = fresh()
    const w2 = fresh()
    await ws.materialize(w1)
    await ws.materialize(w2)
    writeFileSync(join(w1, 'seed.txt'), 'w1\n')
    writeFileSync(join(w2, 'seed.txt'), 'w2\n')

    expect(await ws.commit(w1, 'w1')).toMatchObject({ ok: true })
    expect(await ws.commit(w2, 'w2')).toMatchObject({ ok: false })
  })
})
