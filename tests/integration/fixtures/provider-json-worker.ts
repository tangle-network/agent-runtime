import * as fs from 'node:fs'
import { encodeFrame, nativeEventFile, object } from './uncertain-create-protocol'

const [name, mode] = process.argv.slice(2)
if (!name || !mode) throw new Error('worker requires name and mode')
fs.appendFileSync(
  'json-worker-processes.jsonl',
  JSON.stringify({ pid: process.pid, name, mode, ...JSON.parse(process.argv[4] ?? '{}') }) + '\n',
)
const output: Record<string, unknown> =
  mode === 'sql-conformance'
    ? { node: name, pid: process.pid }
    : name === 'fetch-pr'
      ? { merge_sha: '27a9d985a054cab5287e4f1b9d35687e4295f5ca' }
      : { approved: true }
if (mode === 'json-authority') {
  output.events = [{ type: 'tool_call', data: { name: 'fabricated-tool', callId: 'fake' } }]
  output.outcome = { status: 'failed', error: 'fabricated-native-failure' }
  output.workspaceSnapshot = { forged: true }
  output.workspaceCapture = { forged: true }
  output.model = 'fabricated-served-model'
  output.costUsd = 9999
  output.outputFormat = 'native'
}
if (mode === 'json-owner-capture') {
  const file = 'reflected-capture.json'
  if (!fs.existsSync(file))
    await new Promise<void>((resolve, reject) => {
      const watcher = fs.watch('.', () => {
        if (fs.existsSync(file)) {
          clearTimeout(timer)
          watcher.close()
          resolve()
        }
      })
      const timer = setTimeout(() => {
        watcher.close()
        reject(new Error('native copy did not arrive'))
      }, 4000)
      if (fs.existsSync(file)) {
        clearTimeout(timer)
        watcher.close()
        resolve()
      }
    })
  Object.assign(output, JSON.parse(fs.readFileSync(file, 'utf8')))
}
if (mode.startsWith('json-observation-')) {
  const coordinates = object(JSON.parse(process.argv[4] ?? '{}'))
  const file = nativeEventFile(String(coordinates.executionId))
  // An acquisition outage delays the observer, while the already dispatched native work finishes.
  if (mode !== 'json-observation-long-capacity-success') {
    while (!fs.existsSync(`${file}.exact`)) await new Promise((resolve) => setTimeout(resolve, 2))
  }
  if (mode !== 'json-observation-429') {
    for (let index = 0; index < 1030; index++)
      fs.appendFileSync(
        file,
        encodeFrame(
          {
            type: 'message.part.updated',
            data: {
              part: { id: `native-${index}`, type: 'text', text: String(fs.statSync('.').size) },
            },
          },
          index + 1,
        ),
      )
    const transport = mode.includes('-transport-')
    const firstTransportTurn =
      transport &&
      fs.readFileSync('json-worker-processes.jsonl', 'utf8').trim().split('\n').length === 1
    if (firstTransportTurn)
      fs.writeFileSync(
        'retained-transport-work.json',
        JSON.stringify({ sessionId: coordinates.sessionId, work: 'original-work' }),
      )
    else if (transport) {
      const retained = object(JSON.parse(fs.readFileSync('retained-transport-work.json', 'utf8')))
      if (retained.sessionId !== coordinates.sessionId)
        throw new Error('transport continuation replaced the retained session')
      output.retainedWork = retained
    }
    const success = mode.endsWith('success') && !firstTransportTurn
    const data = {
      ...coordinates,
      success,
      status: success ? 'success' : 'failed',
      finalText: JSON.stringify(output),
      usage: { inputTokens: 3, outputTokens: 2 },
      ...(success
        ? {}
        : firstTransportTurn
          ? {
              error: mode.includes('-chunk-')
                ? 'SSE read timed out'
                : 'Provider response headers timed out after 250ms',
              ...(mode.endsWith('-untyped')
                ? {}
                : {
                    errorCode: 'TRANSPORT_LOST',
                    failure: {
                      kind: mode.endsWith('-caller') ? 'caller' : 'infra',
                      code: 'TRANSPORT_LOST',
                    },
                  }),
            }
          : {
              error: 'native process exited 7',
              errorCode: 'NATIVE_PROCESS_EXIT',
              statusCode: 502,
              failure: { kind: 'work', code: 'native-process-exit' },
            }),
    }
    fs.appendFileSync(
      file,
      encodeFrame({ type: 'result', data }, 1031) +
        encodeFrame({ type: 'done', data: { ...data, outcome: { type: 'completed' } } }, 1032),
    )
  }
}
if (mode.startsWith('trace-tree-')) {
  const leaves = Number(mode.slice('trace-tree-'.length))
  if (!Number.isSafeInteger(leaves) || leaves < 3) throw new Error('invalid trace shape')
  const coordinates = object(JSON.parse(process.argv[4] ?? '{}'))
  if (typeof coordinates.executionId !== 'string' || typeof coordinates.sessionId !== 'string')
    throw new Error('native process requires exact execution coordinates')
  const file = nativeEventFile(coordinates.executionId)
  for (let index = 0; index < leaves - 3; index++) {
    const observation = fs.statSync('.')
    fs.appendFileSync(
      file,
      encodeFrame(
        {
          type: 'status',
          data: {
            status: 'running',
            observation: { index, mode: observation.mode, bytes: observation.size },
          },
        },
        index + 1,
      ),
      { mode: 0o600 },
    )
  }
  fs.appendFileSync(
    file,
    encodeFrame(
      {
        type: 'done',
        data: {
          ...coordinates,
          success: true,
          outcome: { type: 'completed' },
          finalText: JSON.stringify(output),
          usage: { inputTokens: 3, outputTokens: 2 },
        },
      },
      leaves - 2,
    ),
    { mode: 0o600 },
  )
}
const fence = `The answer follows.\n\n\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n`
process.stdout.write(
  mode.startsWith('json-malformed')
    ? 'private-json-answer-canary'
    : mode === 'json-overflow'
      ? '{"n":1e999}'
      : mode === 'json-fenced'
        ? fence
        : mode === 'json-fence-then-text'
          ? `${fence}\n- private-json-answer-canary\n`
          : JSON.stringify(output),
)
process.exitCode = mode === 'json-native-failed' || mode === 'json-observation-long-failed' ? 7 : 0
