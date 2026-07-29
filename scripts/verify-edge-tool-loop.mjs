import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-runtime-edge-tool-loop-'))
const packDir = join(tempRoot, 'pack')
const appDir = join(tempRoot, 'app')
const outputDir = join(appDir, 'worker-dist')

try {
  mkdirSync(packDir, { recursive: true })
  mkdirSync(join(appDir, 'src'), { recursive: true })

  const pack = JSON.parse(
    run('pnpm', ['pack', '--json', '--pack-destination', packDir], repoRoot),
  )
  if (!pack || Array.isArray(pack) || typeof pack.filename !== 'string') {
    throw new Error('expected one packed Runtime archive')
  }
  const archive = resolve(pack.filename)

  writeFileSync(
    join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        private: true,
        type: 'module',
        dependencies: {
          '@tangle-network/agent-runtime': `file:${archive}`,
        },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(appDir, 'wrangler.jsonc'),
    `${JSON.stringify(
      {
        name: 'agent-runtime-edge-tool-loop-check',
        main: 'src/worker.js',
        compatibility_date: '2026-07-28',
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(
    join(appDir, 'src', 'worker.js'),
    `
      import { runToolLoop } from '@tangle-network/agent-runtime/tool-loop'

      export default {
        async fetch() {
          async function* streamTurn() {
            yield { type: 'tool_call', call: { toolName: 'echo', args: { value: 'edge' } } }
            yield { type: 'text', text: 'done' }
          }
          let turn = 0
          const result = await runToolLoop({
            systemPrompt: 'Run one tool.',
            userMessage: 'Echo edge.',
            streamTurn: async function* () {
              turn += 1
              if (turn === 1) yield* streamTurn()
              else yield { type: 'text', text: 'complete' }
            },
            executeToolCall: async (call) => ({ ok: true, result: call.args }),
            isExecutableTool: (name) => name === 'echo',
          })
          return Response.json({
            finalText: result.finalText,
            stopReason: result.stopReason,
            toolCalls: result.toolResults.length,
            turns: result.turns,
          })
        },
      }
    `,
  )

  run(
    'npm',
    ['install', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'],
    appDir,
  )
  run(
    resolve(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    ['deploy', '--dry-run', '--outdir', outputDir],
    appDir,
  )

  const bundle = onlyJavaScriptFile(outputDir)
  const miniflare = new Miniflare({
    compatibilityDate: '2026-07-28',
    modules: true,
    modulesRoot: outputDir,
    scriptPath: bundle,
  })
  try {
    const response = await miniflare.dispatchFetch('http://agent-runtime.test')
    const body = await response.json()
    if (
      response.status !== 200 ||
      body.finalText !== 'donecomplete' ||
      body.stopReason !== 'completed' ||
      body.toolCalls !== 1 ||
      body.turns !== 2
    ) {
      throw new Error(`unexpected Worker response: ${JSON.stringify(body)}`)
    }
  } finally {
    await miniflare.dispose()
  }

  process.stdout.write('Edge tool loop: packed Worker bundled and executed without Node compatibility.\n')
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}

function onlyJavaScriptFile(directory) {
  const files = readdirSync(directory, { recursive: true })
    .filter((file) => typeof file === 'string' && file.endsWith('.js'))
    .map((file) => join(directory, file))
  if (files.length !== 1) {
    throw new Error(`expected one Worker JavaScript bundle, found ${files.length}`)
  }
  return files[0]
}

function run(command, args, cwd) {
  const result = execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300_000,
  })
  return result
}
