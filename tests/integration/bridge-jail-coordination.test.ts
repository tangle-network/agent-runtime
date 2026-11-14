import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { supervise } from '../../src/runtime/index'
import { testContinuation } from '../helpers/continuation'

// The qualifier supplies the PUBLIC entry of the installed, exact cli-bridge artifact named in
// runtime-failure-bridge.md. Bridge routes a jailed native's coordination call only on Linux bwrap.
const bridgeEntry = process.env.RUNTIME_BRIDGE_PACKAGE_ENTRY
const bwrap =
  process.platform === 'linux' &&
  spawnSync('bwrap', ['--ro-bind', '/', '/', '--unshare-all', 'true']).status === 0
interface JailedBridge {
  loadConfig(env: Record<string, string>): Record<string, unknown>
  startServer(options: {
    config: Record<string, unknown>
    handleSignals: false
    quiet: true
  }): Promise<{
    url: string
    close(): Promise<void>
    registerCoordinationEndpoint(input: {
      runId: string
      actorId: string
      url: string
      signal: AbortSignal
    }): () => void
  }>
}

// Disposable native protocol inside the jail, never a model client: it makes the one coordination
// call the materialized MCP config names, records the answer, then ends the turn.
const native = String.raw`
const fs=require('node:fs')
if(process.argv.includes('--version')){process.stdout.write('native-protocol-fixture 1\n');process.exit(0)}
const event=(value)=>process.stdout.write(JSON.stringify(value)+'\n')
;(async()=>{
 const servers=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--mcp-config')+1],'utf8')).mcpServers
 const server=servers['agent-runtime-coordination']
 const response=await fetch(server.url,{method:'POST',headers:{...server.headers,'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'submit_result',arguments:{result:{answer:42}}}})})
 const authorization=Object.keys(server.headers??{}).some((name)=>name.toLowerCase()==='authorization')
 fs.writeFileSync('coordination-call.json',JSON.stringify({url:server.url,authorization,status:response.status,reply:await response.text()}))
 const text=JSON.stringify({answer:42})
 event({type:'system',subtype:'init',session_id:'jailed-coordination',model:'protocol-fixture-model'})
 event({type:'assistant',message:{id:'answer',content:[{type:'text',text}]}})
 event({type:'result',subtype:'success',session_id:'jailed-coordination',result:text,is_error:false,usage:{input_tokens:0,output_tokens:0},total_cost_usd:0})
})().catch((error)=>{process.stderr.write(String(error)+'\n');process.exitCode=1})
`

describe.skipIf(!bridgeEntry || !bwrap)('Runtime coordination through a jailed real Bridge', () => {
  it('mounts coordination by secret reference so the jailed native call is accepted', async () => {
    const bridge = (await import(/* @vite-ignore */ bridgeEntry!)) as JailedBridge
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'runtime-bridge-jail-')))
    const workspace = join(directory, 'workspace')
    await mkdir(workspace)
    const executable = join(workspace, 'native.cjs')
    await writeFile(executable, `#!${process.execPath}\n${native}`, { mode: 0o700 })
    const bearer = 'disposable-jailed-bridge-token'
    const server = await bridge.startServer({
      config: {
        ...bridge.loadConfig({
          BRIDGE_HOST: '127.0.0.1',
          BRIDGE_DATA_DIR: join(directory, 'bridge'),
          BRIDGE_BACKENDS: 'claude',
          BRIDGE_BEARER: bearer,
          BRIDGE_TRACE: 'off',
          CLAUDE_BIN: executable,
          BRIDGE_JAIL_MODE: 'fs-jail',
          BRIDGE_JAIL_FALLBACK: 'deny',
          BRIDGE_JAIL_NETWORK: 'none',
        }),
        port: 0,
      },
      handleSignals: false,
      quiet: true,
    })
    let listener: string | undefined
    try {
      const result = await supervise(
        {
          name: 'jailed-root',
          harness: 'claude-code',
          model: { provider: 'anthropic', default: 'protocol-fixture-model' },
          prompt: { systemPrompt: 'Run the disposable native protocol fixture.' },
          tools: { agent_runtime_coordination_submit_result: true },
        },
        'Submit the protocol result.',
        {
          backend: {
            backend: 'bridge',
            bridgeUrl: server.url,
            bridgeBearer: bearer,
            cwd: workspace,
            outputFormat: 'json',
          },
          budget: { maxIterations: 2, maxTokens: 10_000, deadlineMs: 30_000 },
          deliverable: {
            describe: 'an object whose answer is 42',
            check: (value) => (value as { answer?: unknown }).answer === 42,
          },
          continuation: testContinuation({ deadline: Date.now() + 30_000 }),
          driverRetry: { enabled: false },
          inheritSpawnRights: false,
          runId: 'jailed-coordination-root',
          // The host owns the listener and registers it with its Bridge before dispatch.
          coordination: {
            authentication: true,
            publicUrl: ({ port, runId, actorId, signal }) => {
              listener = `http://127.0.0.1:${port}/mcp`
              server.registerCoordinationEndpoint({ runId, actorId, url: listener, signal })
              return listener
            },
          },
        },
      )
      expect(result, JSON.stringify(result)).toMatchObject({ kind: 'winner', out: { answer: 42 } })
      const call = JSON.parse(await readFile(join(workspace, 'coordination-call.json'), 'utf8'))
      // The native saw only the jail relay and no credential; Bridge injected the bearer upstream.
      expect(call).toMatchObject({ status: 200, authorization: false })
      expect(call.url).not.toBe(listener)
    } finally {
      await server.close()
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
