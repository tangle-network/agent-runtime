import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { isInsideJail, isTestPath, jailPath } from './swe-bench-env'

describe('isTestPath', () => {
  it('flags test directories and test-named python files', () => {
    assert.equal(isTestPath('tests/test_models.py'), true)
    assert.equal(isTestPath('pkg/test/helpers.py'), true)
    assert.equal(isTestPath('pkg/tests/helpers.py'), true)
    assert.equal(isTestPath('test_models.py'), true)
    assert.equal(isTestPath('models_test.py'), true)
    assert.equal(isTestPath('conftest.py'), true)
    assert.equal(isTestPath('pkg/conftest.py'), true)
  })

  it('does not flag ordinary source files', () => {
    assert.equal(isTestPath('src/foo.py'), false)
    assert.equal(isTestPath('pkg/models.py'), false)
    // `testing.py` is not a test file by the test_/_test/conftest rules.
    assert.equal(isTestPath('pkg/testing.py'), false)
    // A `latest/` segment must not trip the `tests?/` directory rule.
    assert.equal(isTestPath('latest/foo.py'), false)
  })
})

describe('jailPath', () => {
  const root = '/work/repo'

  it('rejects `..` traversal and absolute paths', () => {
    assert.equal(jailPath(root, '../x'), null)
    assert.equal(jailPath(root, 'a/../../etc/passwd'), null)
    assert.equal(jailPath(root, '/etc/passwd'), null)
  })

  it('accepts in-repo relative paths and strips a leading `./`', () => {
    assert.equal(jailPath(root, 'src/a.py'), 'src/a.py')
    assert.equal(jailPath(root, './a.py'), 'a.py')
    assert.equal(jailPath(root, 'a.py'), 'a.py')
  })
})

describe('isInsideJail (realpath containment)', () => {
  // Mirror the `resolveInJail` closure in `call()`: realpath-resolve a workspace-relative path, then
  // assert containment. Offline — operates on a throwaway temp dir, no git clone, no network.
  const dir = mkdtempSync(join(tmpdir(), 'swe-jail-'))
  const jailRoot = realpathSync(dir)
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('admits a real file inside the jail', () => {
    const inside = join(dir, 'a.py')
    writeFileSync(inside, 'x = 1\n')
    assert.equal(isInsideJail(jailRoot, realpathSync(inside)), true)
    assert.equal(isInsideJail(jailRoot, jailRoot), true)
  })

  it('rejects reading through a symlink that escapes the jail', () => {
    // A repo could ship `escape -> /etc`; following it must not let the agent read /etc/passwd.
    const link = join(dir, 'escape')
    symlinkSync('/etc', link)
    // `resolveInJail` does `realpathSync(join(ws.dir, relPath))` then this containment check.
    const real = realpathSync(join(dir, 'escape/passwd'))
    assert.equal(real, '/etc/passwd')
    assert.equal(isInsideJail(jailRoot, real), false)
  })

  it('rejects a sibling dir that shares the jail-root prefix', () => {
    assert.equal(isInsideJail('/tmp/swe-x', '/tmp/swe-x-evil/secret'), false)
  })
})
