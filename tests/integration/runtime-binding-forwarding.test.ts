import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execute = promisify(execFile)

/** Fresh consumer process using package exports, actual Sandbox HTTP and Tangle lowering. */
async function run(mode: string) {
  const { stdout } = await execute(
    process.execPath,
    [fileURLToPath(new URL('./fixtures/runtime-binding-forwarding.mjs', import.meta.url)), mode],
    {
      timeout: 10000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir() },
    },
  )
  return JSON.parse(stdout.trim().split('\n').at(-1)!)
}

it('forwards stored host selectors and authored bindings through public Runtime and Tangle exports', async () => {
  expect(await run('selectors')).toEqual({
    selectorsPreserved: true,
    authoredBindingLowered: true,
    candidateRoundTripPreserved: true,
  })
})

it('preserves legacy string identity while binding retained intent to secret destinations', async () => {
  expect(await run('identity')).toEqual({
    stringSelectionOrderStable: true,
    legacyWireIdentityPreserved: true,
    hostChangesIdentity: true,
    headerChangesIdentity: true,
    portableHostChangesIdentity: true,
  })
})

it('retains authored bindings but refuses raw exact candidate execution before effects', async () => {
  expect(await run('raw-candidate')).toEqual({
    rawCandidateRefusedBeforeEffects: true,
    convertedBindingRetained: true,
  })
})
