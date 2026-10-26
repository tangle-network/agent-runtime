import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { object, record } from './uncertain-create-protocol'

const directory = process.argv[2]!
let text = ''
for await (const chunk of process.stdin) text += chunk
const request = object(JSON.parse(text))
const input = object(request.input)
const profile = object(input.profile)
const behavior = JSON.parse(readFileSync(join(directory, 'credential-mode.json'), 'utf8')) as {
  refuse: boolean
  refuseAfter?: number
}
const log = join(directory, 'credential-calls.jsonl')
let count = 0
try {
  count = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
const refused =
  behavior.refuse || (behavior.refuseAfter !== undefined && count >= behavior.refuseAfter)
record(log, {
  kind: 'credential-command',
  at: new Date().toISOString(),
  key: input.idempotencyKey,
  profile: profile.name,
  pid: process.pid,
  number: count + 1,
  refused,
})
if (refused) {
  process.stdout.write(
    JSON.stringify({ error: { code: 'model_credential_refused', reason: 'unsupported_route' } }),
  )
  process.exitCode = 78
} else {
  process.stdout.write(
    JSON.stringify({
      cliAuth: {
        account: 'integration-fixture',
        secretEnv: 'LOCAL_FIXTURE_REFERENCE',
        format: 'bundle',
      },
    }),
  )
}
