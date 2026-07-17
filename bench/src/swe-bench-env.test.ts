import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { after, describe, it } from 'node:test'
import {
  copyPristineGitCheckout,
  firstAvailableSweImageCandidate,
  isInsideJail,
  isTestPath,
  jailPath,
  parseSweImageIdentity,
  parseSweImageCandidates,
  SWE_RUN_TOOL_CONFIG,
  SWE_SEED_PROMPT,
  SWE_SEED_PROMPT_WITH_RUN,
} from './swe-bench-env'
import { absoluteSweTempDir } from './swe-temp'

const makeRelativeSymlinkRepo = (): { root: string; source: string; destination: string; links: string[] } => {
  const root = mkdtempSync(join(tmpdir(), 'swe-cache-copy-'))
  const source = join(root, 'source')
  const destination = join(root, 'destination')
  const targetDir = join(source, 'docs/_theme/djangodocs/static')
  const linkDir = join(source, 'docs/_theme/djangodocs-epub/static')
  const hooksDir = join(root, 'empty-hooks')
  const links = ['docicons-note.png', 'docicons-philosophy.png', 'docicons-behindscenes.png', 'docicons-warning.png']
  mkdirSync(targetDir, { recursive: true })
  mkdirSync(linkDir, { recursive: true })
  mkdirSync(hooksDir)
  mkdirSync(destination)
  for (const name of links) {
    writeFileSync(join(targetDir, name), `${name}\n`)
    symlinkSync(`../../djangodocs/static/${name}`, join(linkDir, name))
  }
  execFileSync('git', ['-C', source, 'init', '--quiet'])
  execFileSync('git', ['-C', source, 'add', '.'])
  execFileSync('git', [
    '-C',
    source,
    '-c',
    'user.name=SWE Fixture',
    '-c',
    'user.email=swe-fixture@example.invalid',
    '-c',
    `core.hooksPath=${hooksDir}`,
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ])
  return { root, source, destination, links }
}

describe('SWE worker prompts', () => {
  it('keeps the run-capable prompt as the exact baseline prompt plus run guidance', () => {
    assert.equal(SWE_SEED_PROMPT_WITH_RUN.startsWith(`${SWE_SEED_PROMPT} `), true)
    assert.match(SWE_SEED_PROMPT_WITH_RUN, /You ALSO have a run tool/)
  })

  it('exports the exact run-tool settings used by the worker surface', () => {
    assert.ok(SWE_RUN_TOOL_CONFIG.timeoutS > 0)
    assert.ok(SWE_RUN_TOOL_CONFIG.outputLimit > 0)
  })

  it('captures immutable Docker image identity independently of a mutable tag', () => {
    assert.deepEqual(
      parseSweImageIdentity(
        JSON.stringify([{ Id: 'sha256:image', RepoDigests: ['repo@sha256:z', 'repo@sha256:a'] }]),
      ),
      { id: 'sha256:image', repoDigests: ['repo@sha256:a', 'repo@sha256:z'] },
    )
    assert.throws(() => parseSweImageIdentity(JSON.stringify([{}])), /no image ID/)
  })

  it('preserves the local fallback namespace when only the unnamespaced image is cached', () => {
    const candidates = parseSweImageCandidates(
      JSON.stringify([
        { tag: 'swebench/sweb.eval.example:latest', namespace: 'swebench' },
        { tag: 'sweb.eval.example:latest', namespace: 'none' },
      ]),
    )
    const localIdentity = { id: 'sha256:local', repoDigests: [] }
    assert.deepEqual(
      firstAvailableSweImageCandidate(candidates, new Map([['sweb.eval.example:latest', localIdentity]])),
      { candidate: { tag: 'sweb.eval.example:latest', namespace: 'none' }, identity: localIdentity },
    )
  })
})

describe('SWE temporary directory', () => {
  it('stays absolute when model temperature is configured through TEMPERATURE', () => {
    const priorTemp = process.env.TEMP
    const priorTemperature = process.env.TEMPERATURE
    try {
      delete process.env.TEMP
      process.env.TEMPERATURE = '0.8'
      assert.equal(isAbsolute(absoluteSweTempDir()), true)

      process.env.TEMP = '0.8'
      assert.throws(() => absoluteSweTempDir(), /must be absolute.*TEMPERATURE/)
    } finally {
      if (priorTemp === undefined) delete process.env.TEMP
      else process.env.TEMP = priorTemp
      if (priorTemperature === undefined) delete process.env.TEMPERATURE
      else process.env.TEMPERATURE = priorTemperature
    }
  })
})

describe('SWE clone cache copy', () => {
  it('preserves Django-style relative symlinks and produces a clean worktree', async () => {
    const fixture = makeRelativeSymlinkRepo()
    try {
      await copyPristineGitCheckout(fixture.source, fixture.destination)
      for (const name of fixture.links) {
        const copiedLink = join(fixture.destination, 'docs/_theme/djangodocs-epub/static', name)
        assert.equal(readlinkSync(copiedLink), `../../djangodocs/static/${name}`)
      }
      assert.equal(
        execFileSync('git', ['-C', fixture.destination, 'status', '--porcelain'], { encoding: 'utf8' }),
        '',
      )
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('fails closed when a cached copy is not pristine', async () => {
    const fixture = makeRelativeSymlinkRepo()
    try {
      writeFileSync(join(fixture.source, 'docs/_theme/djangodocs/static/docicons-note.png'), 'dirty\n')
      await assert.rejects(copyPristineGitCheckout(fixture.source, fixture.destination), /not pristine/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

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
