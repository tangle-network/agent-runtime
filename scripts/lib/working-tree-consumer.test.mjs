import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('packed working-tree fixture identity', () => {
  it.each(['missing', 'configured', 'environment'])(
    'creates its fixture with %s caller identity without changing caller configuration',
    (identity) => {
      const root = mkdtempSync(join(tmpdir(), 'runtime-working-tree-identity-'))
      const home = join(root, 'home')
      const scratch = join(root, 'tmp')
      mkdirSync(home)
      mkdirSync(scratch)
      const config = join(home, '.gitconfig')
      const originalConfig = identity === 'configured'
        ? '[user]\n\tname = Caller\n\temail = caller@example.invalid\n'
        : '[user]\n\tuseConfigOnly = true\n'
      writeFileSync(config, originalConfig)
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_') && key !== 'EMAIL'),
      )
      Object.assign(env, {
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: home,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: config,
        TMPDIR: scratch,
        TMP: scratch,
        TEMP: scratch,
      })
      if (identity === 'environment') {
        Object.assign(env, {
          GIT_AUTHOR_NAME: 'Caller author',
          GIT_AUTHOR_EMAIL: 'caller-author@example.invalid',
          GIT_COMMITTER_NAME: 'Caller committer',
          GIT_COMMITTER_EMAIL: 'caller-committer@example.invalid',
        })
      }
      try {
        const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
          import assert from 'node:assert/strict'
          import { execFileSync, spawnSync } from 'node:child_process'
          import { verifyWorkingTreeConsumer } from ${JSON.stringify(new URL('./working-tree-consumer.mjs', import.meta.url).href)}
          const boundary = new Error('fixture ready')
          let captured = false
          await assert.rejects(verifyWorkingTreeConsumer({
            async captureAgentCandidateWorkspace(source, options) {
              captured = true
              assert.deepEqual(options, { includeRepository: true, repositoryContents: 'working-tree' })
              const identity = execFileSync('git', ['log', '-1', '--format=%an <%ae>|%cn <%ce>'], {
                cwd: source, encoding: 'utf8',
              }).trim()
              assert.equal(identity, 'Runtime packed consumer <runtime-packed-consumer@example.invalid>|Runtime packed consumer <runtime-packed-consumer@example.invalid>')
              const config = spawnSync('git', ['config', '--local', '--get-regexp', '^(user|author|committer)[.]'], {
                cwd: source, encoding: 'utf8',
              })
              assert.equal(config.status, 1)
              assert.equal(config.stdout, '')
              // Stop at the installed-package boundary: this regression tests only fixture setup.
              throw boundary
            },
          }, {}), (error) => error === boundary)
          assert.equal(captured, true)
        `], { env, encoding: 'utf8', timeout: 10_000 })
        expect(result.error).toBeUndefined()
        expect(result.status, result.stdout + result.stderr).toBe(0)
        expect(readFileSync(config, 'utf8')).toBe(originalConfig)
        expect(readdirSync(scratch)).toEqual([])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})
