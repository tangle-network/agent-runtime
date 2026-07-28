import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitWorkspace, jjWorkspace, runInWorkspace } from '../../src/runtime/workspace'

const hasPython = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
})()

/** jj is optional and absent in CI — its block skips unless the binary is present. */
const hasJj = (() => {
  try {
    execFileSync('jj', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
})()

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

  it.skipIf(!hasPython)(
    'runInWorkspace: a second worker builds on the first, gated by a real test',
    async () => {
      // Seed the shared ref with a failing task (two functions to implement, one test).
      const seed = fresh()
      await gitWorkspace({ ref: bare }).materialize(seed)
      writeFileSync(
        join(seed, 'solution.py'),
        'def add(a, b):\n    raise NotImplementedError\n\n\ndef mul(a, b):\n    raise NotImplementedError\n',
      )
      writeFileSync(
        join(seed, 'test_solution.py'),
        'from solution import add, mul\nassert add(2, 3) == 5\nassert mul(2, 3) == 6\nprint("PASS")\n',
      )
      git(['add', '-A'], seed)
      git(['commit', '-m', 'task'], seed)
      git(['push', 'origin', 'main'], seed)

      const ws = gitWorkspace({ ref: bare })
      const runTest = (cwd: string): boolean => {
        try {
          execFileSync('python3', ['test_solution.py'], { cwd, stdio: 'pipe', timeout: 30_000 })
          return true
        } catch {
          return false
        }
      }

      // Worker 1 implements add() only — the test still fails (mul missing), but it commits WIP.
      const r1 = await runInWorkspace(
        ws,
        async (cwd) => {
          const src = readFileSync(join(cwd, 'solution.py'), 'utf-8').replace(
            'def add(a, b):\n    raise NotImplementedError',
            'def add(a, b):\n    return a + b',
          )
          writeFileSync(join(cwd, 'solution.py'), src)
          return { valid: runTest(cwd), value: 'w1', message: 'w1: add()' }
        },
        { commitOnInvalid: true },
      )
      expect(r1.valid).toBe(false)
      expect(r1.commit).toMatchObject({ ok: true })

      // Worker 2 materializes a FRESH clone — it must already see worker 1's add(), then finish mul().
      const r2 = await runInWorkspace(ws, async (cwd) => {
        const before = readFileSync(join(cwd, 'solution.py'), 'utf-8')
        expect(before).toContain('return a + b') // compounding: it built on worker 1
        const src = before.replace(
          'def mul(a, b):\n    raise NotImplementedError',
          'def mul(a, b):\n    return a * b',
        )
        writeFileSync(join(cwd, 'solution.py'), src)
        return { valid: runTest(cwd), value: 'w2', message: 'w2: mul()' }
      })
      expect(r2.valid).toBe(true)
      expect(r2.commit).toMatchObject({ ok: true })
    },
  )

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

describe.skipIf(!hasJj)('jjWorkspace', () => {
  let bare: string
  const temps: string[] = []
  const fresh = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-jj-work-'))
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

  it('carries durable state across fresh worker filesystems (jj drop-in)', async () => {
    const ws = jjWorkspace({ ref: bare })
    const w1 = fresh()
    await ws.materialize(w1)
    writeFileSync(join(w1, 'a.txt'), 'one\n')
    expect(await ws.commit(w1, 'add a')).toMatchObject({ ok: true })

    const w2 = fresh()
    await ws.materialize(w2)
    expect(existsSync(join(w2, 'a.txt'))).toBe(true)
    expect(readFileSync(join(w2, 'a.txt'), 'utf-8')).toBe('one\n')
  })
})
