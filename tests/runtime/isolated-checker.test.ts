import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type IsolatedCheckBox, runIsolatedCheck } from '../../src/runtime/isolated-checker'

describe('isolated checker refusal', () => {
  it('refuses unavailable hosts or invalid protected trees without running the command', async () => {
    const result = await runIsolatedCheck({
      workspaceRoot: '/runtime-checker-missing-workspace',
      tree: '/runtime-checker-missing-workspace/run',
      command: ['/bin/sh', '-c', 'echo must-not-run'],
    })
    expect(result.succeeded).toBe(false)
    if (!result.succeeded) expect(result.reason).toBe('refused')
  })

  // Every key of an account reaches every box of that account, so a check box on an account
  // the judged run holds a key to is writable by the run. No such box may ever be created.
  it('refuses a check box on an account the judged run holds a key to, before creating it', async () => {
    const tree = await mkdtemp(join(tmpdir(), 'runtime-check-box-'))
    await writeFile(join(tree, 'artifact.txt'), 'judged bytes')
    let created = 0
    const client = {
      getIdentity: async () => ({
        customerId: 'cust_builder',
        billingOwnerId: 'owner',
        apiKeyId: 'key_check',
        billingDelegationAuthorized: false,
      }),
      createIsolated: async () => {
        created += 1
        throw new Error('a box must not be created')
      },
    } as unknown as IsolatedCheckBox['client']
    try {
      const result = await runIsolatedCheck({
        workspaceRoot: tree,
        tree,
        command: ['/bin/cat', 'artifact.txt'],
        box: { client, builderAccounts: ['cust_other', 'cust_builder'], environment: 'universal' },
      })
      expect(created).toBe(0)
      expect(result).toMatchObject({ succeeded: false, reason: 'refused' })
      if (!result.succeeded) expect(result.diagnostic).toMatch(/cust_builder/)
      expect(result.box).toBeUndefined()
    } finally {
      await rm(tree, { recursive: true, force: true })
    }
  })
})
