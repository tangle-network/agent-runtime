import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { sameControlCoordinates } from '../../src/runtime/retained-run-binding'
import { durableRetainedProvider } from './durable-retained-provider'
import { runFixtureProcess } from './fixture-process'

/** Offline retained provider backed by durable control state and a native process per dispatch. */
export function nativeSeatProvider(
  directory: string,
  fixtureOptions: { success?: boolean; recordOutput?: boolean; emitOutput?: boolean } = {},
): AgentEnvironmentProvider {
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const runs = new Map<string, ReturnType<typeof runFixtureProcess>>()
  const recorded = new Set<string>()
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    async dispatch(turn) {
      const admitted = await environment.dispatch!(turn)
      const control = admitted.controlRef!
      await appendFile(join(directory, 'dispatches.jsonl'), `${JSON.stringify(control)}\n`)
      const program = String.raw`
const fs = require('node:fs')
const control = JSON.parse(process.argv[1])
const receipt = { pid: process.pid, control, usage: { inputTokens: 5, outputTokens: 0 } }
fs.appendFileSync('native-receipts.jsonl', JSON.stringify(receipt) + '\n')
const success = process.argv[2] !== 'false'
process.stdout.write(JSON.stringify({ text: success ? 'native completed' : 'native failed', success, usage: receipt.usage, ...(success ? {} : { error: 'native fixture work failed', failure: { kind: 'work', code: 'native-fixture-work' } }) }))
`
      runs.set(
        control.executionId!,
        runFixtureProcess({
          args: ['-e', program, JSON.stringify(control), String(fixtureOptions.success ?? true)],
          cwd: directory,
        }),
      )
      return admitted
    },
    session(id, options) {
      const session = environment.session!(id, options)
      const readCompleted = async () => {
        const run = runs.get(session.controlRef!.executionId!)
        if (!run && !fixtureOptions.recordOutput)
          throw new Error('no native dispatch for exact result')
        const completed = run
          ? await run
          : (await readFile(join(directory, 'native-output.jsonl'), 'utf8'))
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line))
              .find((record) => sameControlCoordinates(record.controlRef, session.controlRef!))
        if (!completed) throw new Error('no persisted native result for exact control')
        if (completed.exitCode !== 0) throw new Error(completed.stderr)
        return completed
      }
      return {
        ...session,
        async *events(options) {
          // These frames describe the real child after exit, including its actual stdout.
          if (fixtureOptions.emitOutput) {
            const completed = await readCompleted()
            const frames: AgentEnvironmentEvent[] = [
              {
                id: 'native-output',
                type: 'message.part.updated',
                data: { part: { id: 'stdout', type: 'text', text: completed.stdout } },
              },
              {
                id: 'native-exit',
                type: 'result',
                data: {
                  finalText: completed.stdout,
                  success: JSON.parse(completed.stdout).success,
                },
              },
            ]
            const start =
              options?.since === undefined
                ? 0
                : frames.findIndex((frame) => frame.id === options.since) + 1
            if (options?.since !== undefined && start === 0)
              throw new Error('unknown native event cursor')
            yield* frames.slice(start)
            return
          }
          await runs.get(session.controlRef!.executionId!)
          yield* session.events!(options)
        },
        async result() {
          const completed = await readCompleted()
          if (
            runs.has(session.controlRef!.executionId!) &&
            fixtureOptions.recordOutput &&
            !recorded.has(session.controlRef!.executionId!)
          ) {
            await appendFile(
              join(directory, 'native-output.jsonl'),
              `${JSON.stringify({ controlRef: session.controlRef, ...completed })}\n`,
            )
            recorded.add(session.controlRef!.executionId!)
          }
          return { ...(await session.result()), ...JSON.parse(completed.stdout) }
        },
      }
    },
  })
  return {
    ...base,
    capabilities: async () => ({ ...(await base.capabilities()), usage: true }),
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const environment = await base.get!(id)
      return environment && wrap(environment)
    },
  }
}
