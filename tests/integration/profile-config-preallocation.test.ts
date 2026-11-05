import { execFile } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  AGENT_PROFILE_MATERIALIZATION_AXES,
  type AgentProfile,
} from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { createCommandModelCredentialResolver } from '@tangle-network/agent-provider-tangle/node'
import { Sandbox } from '@tangle-network/sandbox'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createFileRunContext, type DriveHarness, supervise } from '../../src/runtime'
import { testContinuation } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'
import {
  type Executables,
  ProcessFixture,
  prepareExecutables,
} from './fixtures/uncertain-create-harness'
import { object } from './fixtures/uncertain-create-protocol'

const execute = promisify(execFile)
const native = `
const fs = require('node:fs')
const config = JSON.parse(process.env.PROFILE_CONTROL)
fs.writeFileSync('profile-native-start.json',JSON.stringify({pid:process.pid}))
process.on('exit',code=>fs.writeFileSync('profile-native-exit.json',JSON.stringify({pid:process.pid,code})))
const rpc = async (method, params) => {
  const response = await fetch(config.url, { method:'POST', signal:AbortSignal.timeout(5000),
    headers:{'content-type':'application/json',...config.headers},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}) })
  if(response.status!==200)throw new Error('MCP HTTP '+response.status)
  return await response.json()
}
;(async()=>{
  const tools = await rpc('tools/list')
  fs.writeFileSync('profile-tools-list.json',JSON.stringify(tools))
  if(!tools.result.tools.some(tool=>tool.name==='spawn_worker'))throw new Error('spawn_worker not mounted')
  const reply = await rpc('tools/call',{name:'spawn_worker',arguments:{profile:config.child,task:'Read the local fixture.',key:'captured-control'}})
  fs.writeFileSync('profile-control.json',JSON.stringify({pid:process.pid,reply}))
  await rpc('tools/call',{name:'submit_result',arguments:{result:{refusalObserved:true}}})
})().catch(error=>{console.error(error);process.exitCode=1})
`
let bundle: string
let executables: Executables
beforeAll(async () => {
  ;({ bundle, executables } = await prepareExecutables())
})
afterAll(async () => {
  if (bundle) await rm(bundle, { recursive: true, force: true })
})

const controls: Array<{
  name: string
  child: AgentProfile
  field?: string
  command?: 'infra' | 'capacity' | 'caller'
  failure?: { code: string; owner: string; providerCode: string }
}> = [
  ...(
    [
      ['infra', 'transport', 'platform', 'credential_command_failed'],
      ['capacity', 'upstream-unavailable', 'platform', 'provider_quota_exhausted'],
      ['caller', 'request-rejected', 'caller', 'model_credential_refused'],
    ] as const
  ).map(([command, code, owner, providerCode]) => ({
    name: `command-${command}`,
    child: testAgentProfile(`command-${command}`, {
      prompt: { instructions: ['private-command-stdin-stderr-sentinel'] },
      model: {
        provider: 'offline',
        default: 'offline-test-model',
        metadata: { credentialSource: 'subscription' },
      },
    }),
    command,
    failure: { code, owner, providerCode },
  })),
  {
    name: 'nonexistent-opencode-tool',
    child: testAgentProfile('malformed-tool', {
      tools: { agent_coordination_knowledge_record_placeholder: true },
    }),
    field: 'agent_coordination_knowledge_record_placeholder',
  },
  {
    // Permission names are captured; allow is a representative unsupported decision value.
    name: 'codex-tool-permissions',
    child: testAgentProfile('malformed-codex', {
      harness: 'codex',
      tools: { exec_command: true, web_search: true },
      permissions: { read: 'allow', edit: 'allow', bash: 'allow' },
    }),
    field: 'PROFILE_UNSUPPORTED',
  },
  // The packet retains the metadata schema class, not the offending key or value.
  {
    name: 'synthetic-model-metadata-schema',
    child: testAgentProfile('malformed-metadata', {
      tools: {
        agent_runtime_coordination_spawn_worker: false,
        agent_runtime_coordination_submit_result: false,
      },
      model: {
        provider: 'offline',
        default: 'offline-test-model',
        metadata: { seat: 'synthetic-schema-control' },
      },
    }),
    field: 'AgentProfile.model.metadata',
  },
]

it.each(controls)(
  'refuses $name through native MCP before child allocation',
  async ({ name, child, field, command, failure }) => {
    const fixture = await ProcessFixture.start('json-output', executables, { coordinator: false })
    const runId = `profile-preallocation-${name}`
    const context = createFileRunContext(join(fixture.directory, 'run'), { withDriver: true })
    const credentialCommand = [
      process.execPath,
      '-e',
      `
      let input=''; process.stdin.on('data',chunk=>input+=chunk); process.stdin.on('end',()=>{
        const request=JSON.parse(input), selected=request.input.profile.name===process.env.CHILD;
        require('node:fs').appendFileSync(process.env.RECEIPT,JSON.stringify({pid:process.pid,profile:request.input.profile.name,key:request.input.idempotencyKey})+'\\n');
        if(!selected){process.stdout.write('{"supported":true}');return}
        process.stderr.write(process.env.PRIVATE_SENTINEL);
        const mode=process.env.MODE;
        process.stdout.write(JSON.stringify({error:mode==='capacity'?{code:'provider_quota_exhausted',reason:'exhausted'}:{code:'model_credential_refused',reason:'unsupported_route'}}));
        process.exitCode=mode==='infra'?1:mode==='capacity'?75:78;
      });`,
    ]
    const provider = createTangleProvider({
      ...(command
        ? {
            modelCredentials: createCommandModelCredentialResolver({
              command: credentialCommand,
              validationCommand: credentialCommand,
              env: {
                CHILD: child.name,
                MODE: command,
                PRIVATE_SENTINEL: 'private-command-stdin-stderr-sentinel',
                RECEIPT: join(fixture.directory, 'validation.jsonl'),
              },
            }),
          }
        : {}),
      client: new Sandbox({
        apiKey: 'offline-not-a-secret',
        baseUrl: fixture.url,
        platformUrl: fixture.url,
        trustLocalCliAuth: false,
        directExec: false,
      }),
    })
    const budgets: unknown[] = []
    let nativeCalls = 0
    const attempts: unknown[] = []
    let nativeCompletion: unknown
    const driveHarness: DriveHarness = async (driver) => {
      nativeCalls++
      budgets.push(driver.scope.budget)
      try {
        const completed = await execute(process.execPath, ['-e', native], {
          cwd: fixture.directory,
          timeout: 5000,
          signal: driver.scope.signal,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(([key]) => key === 'PATH' || key === 'HOME'),
            ),
            PROFILE_CONTROL: JSON.stringify({
              child,
              url: driver.coordinationMcpUrl,
              headers: driver.coordinationMcpHeaders,
            }),
          },
        })
        nativeCompletion = { code: 0, stdout: completed.stdout, stderr: completed.stderr }
      } catch (error) {
        const failed = error as Error & { code?: string | number; stdout?: string; stderr?: string }
        nativeCompletion = {
          code: failed.code,
          stdout: failed.stdout,
          stderr: failed.stderr,
          error: failed.message,
        }
        throw error
      } finally {
        await writeFile(
          join(fixture.directory, 'profile-native-completion.json'),
          JSON.stringify(nativeCompletion),
        )
        budgets.push(driver.scope.budget)
      }
    }
    let passed = false
    try {
      const result = await supervise(
        testAgentProfile('native-profile-parent', {
          harness: 'codex',
          tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
        }),
        'Refuse malformed local controls.',
        {
          runContext: context,
          runId,
          runDir: join(fixture.directory, 'run'),
          budget: { maxTokens: 1000, maxIterations: 4, deadlineMs: 10000 },
          perWorker: { maxTokens: 100, maxIterations: 1 },
          backend: { backend: 'provider', provider },
          driveHarness,
          driveHarnessMaterialization: {
            name: 'native-http-profile-control',
            axes: AGENT_PROFILE_MATERIALIZATION_AXES,
          },
          coordination: { host: '127.0.0.1', port: 0, authentication: true },
          driverRetry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
          continuation: testContinuation({ deadline: Date.now() + 10000, maxBarren: 1 }),
          onDriverAttempt(record) {
            attempts.push(record)
          },
          finalizer: () => undefined,
          deliverable: {
            async check(candidate) {
              if (
                !candidate ||
                typeof candidate !== 'object' ||
                !('refusalObserved' in candidate) ||
                candidate.refusalObserved !== true
              )
                return false
              const bytes = await readFile(
                join(fixture.directory, 'profile-control.json'),
                'utf8',
              ).catch(() => undefined)
              if (bytes === undefined) return false
              const response = object(JSON.parse(bytes).reply)
              if (command) return object(response.error).code === -32000
              const tool = object(response.result)
              const observed = object(
                tool.structuredContent ??
                  JSON.parse(object((tool.content as unknown[])[0]).text as string),
              )
              return observed.error === 'preflight-refused'
            },
          },
        },
      )
      await writeFile(
        join(fixture.directory, 'profile-parent-result.json'),
        JSON.stringify({ result, attempts, nativeCalls, nativeCompletion }),
      )
      const receiptBytes = await readFile(
        join(fixture.directory, 'profile-control.json'),
        'utf8',
      ).catch(() => undefined)
      expect(
        receiptBytes,
        JSON.stringify({ result, attempts, nativeCalls, nativeCompletion }),
      ).toBeDefined()
      const receipt = JSON.parse(receiptBytes!)
      const reply = object(receipt.reply)
      if (command) {
        expect(reply).toMatchObject({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, data: { failure } },
        })
        expect(object(object(reply.error).data).failure).toEqual(failure)
        expect(JSON.stringify(reply)).not.toContain('private-command-stdin-stderr-sentinel')
        const validations = (await readFile(join(fixture.directory, 'validation.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(validations.filter((row) => row.profile === child.name)).toEqual([
          { pid: expect.any(Number), profile: child.name, key: 'profile-preflight' },
        ])
      } else {
        const tool = object(reply.result)
        const refusal = object(
          tool.structuredContent ??
            JSON.parse(object((tool.content as unknown[])[0]).text as string),
        )
        expect(refusal).toMatchObject({
          error: 'preflight-refused',
          cause: expect.any(String),
          live: 0,
        })
        expect(refusal.reason).toContain(field!)
      }
      expect(nativeCalls).toBe(1)
      expect(budgets).toHaveLength(2)
      expect(budgets[1]).toEqual(budgets[0])
      expect(() => process.kill(receipt.pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
      const events = (await context.journal.loadTree(runId))!
      expect(
        events.filter((event) => event.kind === 'spawned' && event.parent !== undefined),
      ).toEqual([])
      expect(
        events.filter(
          (event) => event.kind === 'admission-queued' || event.kind === 'admission-granted',
        ),
      ).toEqual([])
      expect(
        events.filter((event) => event.kind === 'execution-input' && event.id !== runId),
      ).toEqual([])
      const state = await fixture.state()
      expect(state.boxes).toEqual([])
      expect(state.provisions).toEqual([])
      expect(state.runs).toEqual([])
      expect(
        state.requests.filter((row) => row.kind === 'create' || row.kind === 'dispatch'),
      ).toEqual([])
      if (command)
        expect(state.requests).toEqual([
          {
            kind: 'service-ready',
            at: expect.any(String),
            pid: expect.any(Number),
            url: fixture.url,
          },
        ])
      expect(state.failures).toEqual([])
      expect(result.kind).toBe('winner')
      passed = true
    } finally {
      await fixture.close()
      if (passed) await rm(fixture.directory, { recursive: true, force: true })
      else console.error('Profile preallocation proof artifacts:', fixture.directory)
    }
  },
  20000,
)
