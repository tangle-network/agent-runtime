import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isInsideJail, isTestPath, jailPath } from './swe-bench-env'

describe('isTestPath', () => {
  it('flags test directories and test-named python files', () => {
    expect(isTestPath('tests/test_models.py')).toBe(true)
    expect(isTestPath('pkg/test/helpers.py')).toBe(true)
    expect(isTestPath('pkg/tests/helpers.py')).toBe(true)
    expect(isTestPath('test_models.py')).toBe(true)
    expect(isTestPath('models_test.py')).toBe(true)
    expect(isTestPath('conftest.py')).toBe(true)
    expect(isTestPath('pkg/conftest.py')).toBe(true)
  })

  it('does not flag ordinary source files', () => {
    expect(isTestPath('src/foo.py')).toBe(false)
    expect(isTestPath('pkg/models.py')).toBe(false)
    // `testing.py` is not a test file by the test_/_test/conftest rules.
    expect(isTestPath('pkg/testing.py')).toBe(false)
    // A `latest/` segment must not trip the `tests?/` directory rule.
    expect(isTestPath('latest/foo.py')).toBe(false)
  })
})

describe('jailPath', () => {
  const root = '/work/repo'

  it('rejects `..` traversal and absolute paths', () => {
    expect(jailPath(root, '../x')).toBeNull()
    expect(jailPath(root, 'a/../../etc/passwd')).toBeNull()
    expect(jailPath(root, '/etc/passwd')).toBeNull()
  })

  it('accepts in-repo relative paths and strips a leading `./`', () => {
    expect(jailPath(root, 'src/a.py')).toBe('src/a.py')
    expect(jailPath(root, './a.py')).toBe('a.py')
    expect(jailPath(root, 'a.py')).toBe('a.py')
  })
})

describe('isInsideJail (realpath containment)', () => {
  // Mirror the `resolveInJail` closure in `call()`: realpath-resolve a workspace-relative path, then
  // assert containment. Offline — operates on a throwaway temp dir, no git clone, no network.
  const dir = mkdtempSync(join(tmpdir(), 'swe-jail-'))
  const jailRoot = realpathSync(dir)
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('admits a real file inside the jail', () => {
    const inside = join(dir, 'a.py')
    writeFileSync(inside, 'x = 1\n')
    expect(isInsideJail(jailRoot, realpathSync(inside))).toBe(true)
    expect(isInsideJail(jailRoot, jailRoot)).toBe(true)
  })

  it('rejects reading through a symlink that escapes the jail', () => {
    // A repo could ship `escape -> /etc`; following it must not let the agent read /etc/passwd.
    const link = join(dir, 'escape')
    symlinkSync('/etc', link)
    // `resolveInJail` does `realpathSync(join(ws.dir, relPath))` then this containment check.
    const real = realpathSync(join(dir, 'escape/passwd'))
    expect(real).toBe('/etc/passwd')
    expect(isInsideJail(jailRoot, real)).toBe(false)
  })

  it('rejects a sibling dir that shares the jail-root prefix', () => {
    expect(isInsideJail('/tmp/swe-x', '/tmp/swe-x-evil/secret')).toBe(false)
  })
})
