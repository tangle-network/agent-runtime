import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectRequiredTangleDependencies,
  waitForPublishedDependencies,
} from './wait-for-published-dependencies.mjs'

test('collects required published Tangle dependencies from a packed manifest', () => {
  const dependencies = collectRequiredTangleDependencies({
    name: '@tangle-network/agent-bench',
    dependencies: {
      '@tangle-network/agent-runtime': '0.108.1',
      '@tangle-network/agent-eval': '0.134.2',
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
    { name: '@tangle-network/agent-eval', spec: '0.134.2' },
    { name: '@tangle-network/agent-interface', spec: '>=0.36.0 <0.37.0' },
    { name: '@tangle-network/agent-runtime', spec: '0.108.1' },
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
