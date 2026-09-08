import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  collectRequiredTangleDependencies,
  probeNpm,
  waitForPublishedDependencies,
} from './wait-for-published-dependencies.mjs'

test('collects required published Tangle dependencies from a packed manifest', () => {
  const dependencies = collectRequiredTangleDependencies({
    name: '@tangle-network/agent-bench',
    dependencies: {
      '@tangle-network/agent-runtime': '0.109.2',
      '@tangle-network/agent-eval': '0.135.2',
      undici: '^7.0.0',
    },
    peerDependencies: {
      '@tangle-network/agent-interface': '>=0.36.0 <0.37.0',
      '@tangle-network/optional-peer': '1.0.0',
    },
    peerDependenciesMeta: {
      '@tangle-network/optional-peer': { optional: true },
    },
    devDependencies: {
      '@tangle-network/dev-only': '1.0.0',
    },
  })

  assert.deepEqual(dependencies, [
    { name: '@tangle-network/agent-eval', spec: '0.135.2' },
    { name: '@tangle-network/agent-interface', spec: '>=0.36.0 <0.37.0' },
    { name: '@tangle-network/agent-runtime', spec: '0.109.2' },
  ])
})

test('retries only unavailable dependencies until all are published', async () => {
  const dependencies = [
    { name: '@tangle-network/already-published', spec: '1.0.0' },
    { name: '@tangle-network/publishes-later', spec: '2.0.0' },
  ]
  const calls = new Map()
  const reports = []
  let currentTime = 0

  const result = await waitForPublishedDependencies(dependencies, {
    timeoutMs: 100,
    intervalMs: 25,
    now: () => currentTime,
    sleep: async (milliseconds) => {
      currentTime += milliseconds
    },
    probe: async ({ name }) => {
      const count = (calls.get(name) ?? 0) + 1
      calls.set(name, count)
      return {
        available: name.endsWith('already-published') || count >= 3,
        detail: 'not published yet',
      }
    },
    report: (message) => reports.push(message),
  })

  assert.deepEqual(result, { attempts: 3, elapsedMs: 50 })
  assert.equal(calls.get('@tangle-network/already-published'), 1)
  assert.equal(calls.get('@tangle-network/publishes-later'), 3)
  assert.equal(reports.length, 3)
})

test('fails at the deadline and names every dependency still missing', async () => {
  const dependencies = [
    { name: '@tangle-network/never-published', spec: '9.9.9' },
    { name: '@tangle-network/also-missing', spec: '8.8.8' },
  ]
  let currentTime = 0

  await assert.rejects(
    waitForPublishedDependencies(dependencies, {
      timeoutMs: 100,
      intervalMs: 40,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        currentTime += milliseconds
      },
      probe: async () => ({ available: false, detail: 'npm error code E404' }),
      report: () => {},
    }),
    (error) => {
      assert.match(error.message, /Timed out after 100ms and 3 attempts/)
      assert.match(error.message, /@tangle-network\/never-published@9\.9\.9/)
      assert.match(error.message, /@tangle-network\/also-missing@8\.8\.8/)
      assert.match(error.message, /npm error code E404/)
      return true
    },
  )
  assert.equal(currentTime, 100)
})

test('waits for the exact package archive after metadata is published', async () => {
  const dependency = { name: '@tangle-network/agent-runtime', spec: '0.200.0' }
  let currentTime = 0
  let archiveAttempts = 0
  const scratchDirectories = []
  const result = await waitForPublishedDependencies([dependency], {
    timeoutMs: 100,
    intervalMs: 25,
    now: () => currentTime,
    sleep: async (milliseconds) => {
      currentTime += milliseconds
    },
    report: () => {},
    probe: (requested, options) => probeNpm(requested, {
      ...options,
      run: async (command, args, executionOptions) => {
        assert.equal(command, 'npm')
        // Metadata is already visible, but its archive is not installable yet.
        if (args[0] === 'view') return { stdout: JSON.stringify('0.200.0') }
        assert.equal(args[0], 'pack')
        assert.equal(args[1], '@tangle-network/agent-runtime@0.200.0')
        assert.ok(args.includes('--ignore-scripts'))
        const scratch = args[args.indexOf('--pack-destination') + 1]
        assert.equal(args[args.indexOf('--cache') + 1], path.join(scratch, 'cache'))
        scratchDirectories.push(scratch)
        assert.ok(executionOptions.timeout <= 100 - currentTime)
        archiveAttempts++
        if (archiveAttempts === 1) {
          throw Object.assign(new Error('archive unavailable'), {
            stderr: 'npm error E404 GET agent-runtime-0.200.0.tgz',
          })
        }
        return { stdout: JSON.stringify([{ name: dependency.name, version: '0.200.0' }]) }
      },
    }),
  })
  assert.deepEqual(result, { attempts: 2, elapsedMs: 25 })
  assert.equal(archiveAttempts, 2)
  assert.equal(new Set(scratchDirectories).size, 2)
  for (const scratch of scratchDirectories) {
    await assert.rejects(access(scratch), { code: 'ENOENT' })
  }
})

test('reports a permanently invalid package archive at the existing deadline', async () => {
  let currentTime = 0
  await assert.rejects(waitForPublishedDependencies([
    { name: '@tangle-network/agent-runtime', spec: '0.200.0' },
  ], {
    timeoutMs: 50,
    intervalMs: 25,
    now: () => currentTime,
    sleep: async (milliseconds) => {
      currentTime += milliseconds
    },
    report: () => {},
    probe: (dependency, options) => probeNpm(dependency, {
      ...options,
      run: async () => {
        throw Object.assign(new Error('archive integrity mismatch'), {
          stderr: 'npm error code EINTEGRITY',
        })
      },
    }),
  }), /Timed out after 50ms and 2 attempts[\s\S]*agent-runtime@0\.200\.0: npm error code EINTEGRITY/)
})
