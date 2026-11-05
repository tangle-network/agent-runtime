import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  ATTR,
  type ContractSpan,
  LINK_KIND_ATTR,
  validateTraceSpans,
} from '@tangle-network/agent-trace-contract'
import {
  decodeOtlpAttributes,
  decodeOtlpTraceExport,
} from '@tangle-network/agent-trace-contract/otlp'
import { expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { FileResultBlobStore } from '../../src/durable/spawn-journal/result-blob-store'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import { createOpenInferenceFileExporter } from '../../src/otel-export'
import { providerAsExecutor } from '../../src/runtime/environment-provider/provider-executor-admission'
import { routerChatWithUsage } from '../../src/runtime/router-client'
import { createSupervisorSpanRecorder } from '../../src/runtime/supervise/otel-spans'
import { nodeStreamFile, readRootStream } from '../../src/runtime/supervise/root-stream'
import {
  createExecutorRegistry,
  routerToolsInlineExecutor,
} from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, ExecutorFactory } from '../../src/runtime/supervise/types'
import { zeroSpend } from '../../src/runtime/util'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'
import { nativeSeatProvider } from '../helpers/native-seat-provider'
import { createLiveTraceFixture, waitFor } from '../helpers/runtime-live-trace'
import { testAgentProfile } from '../kernel/test-agent-profile'

it.each([false, true])(
  'exports live native/inline work without duplicate node streams (private details=%s)',
  async (includeDetails) => {
    const fixture = await createLiveTraceFixture()
    const {
      directory,
      sentinel,
      modelEntered,
      modelReply,
      admissionEntered,
      admissionAck,
      collectorReply,
      workFinished,
      rootReply,
      bodies,
      journal,
      endpoint,
    } = fixture
    const hooks: RuntimeHookEvent[] = []
    const recorder = createSupervisorSpanRecorder({
      runId: 'live-trace',
      includeMetadata: includeDetails,
      includeEvalDetails: includeDetails,
      exportConfig: {
        endpoint,
        batchSize: 1,
        flushIntervalMs: 10,
        timeoutMs: 5000,
      },
    })!
    const provider = nativeSeatProvider(directory)
    const leaf = (
      name: string,
      profile: AgentProfile,
      factory: ExecutorFactory<unknown>,
    ): Agent<unknown, unknown> =>
      Object.assign(
        {
          name,
          act: async () => {
            throw new Error('executor agent must use its factory')
          },
        },
        { executorSpec: { profile, harness: profile.harness ?? null, executorFactory: factory } },
      )
    const native = leaf(
      'native',
      testAgentProfile('native', { model: { provider: 'fixture', default: 'fixture/native' } }),
      providerAsExecutor(provider),
    )
    const inline = leaf(
      'inline',
      testAgentProfile('inline', {
        harness: 'cli-base',
        tools: { remote: true },
        model: { default: 'offline-test-model', metadata: { maxTurns: 2 } },
      }),
      (spec, ctx) =>
        routerToolsInlineExecutor(spec, {
          ...ctx,
          seams: {
            ...ctx.seams,
            'router-tools': {
              routerBaseUrl: `${endpoint}/v1`,
              routerKey: 'offline-proof-key',
              tools: [
                { type: 'function', function: { name: 'remote', parameters: { type: 'object' } } },
              ],
              executeToolCall: async () => {
                const reply = await fetch(`${endpoint}/tool`)
                if (!reply.ok) throw new Error(await reply.text())
                return reply.text()
              },
            },
          },
        }),
    )
    const silent = leaf('promise-process', testAgentProfile('promise-process'), () => ({
      runtime: 'cli',
      async execute(_task, signal) {
        const processResult = await runSettledCommand({
          command: process.execPath,
          args: ['-e', 'process.stdout.write(String(process.pid))'],
          cwd: directory,
          signal,
          timeoutMs: 5000,
        })
        if (processResult.exitCode !== 0) throw new Error(processResult.stderr)
        return { outRef: 'silent-process', out: processResult.stdout, spent: zeroSpend() }
      },
      resultArtifact() {
        throw new Error('Promise execution returns its artifact directly')
      },
      async teardown() {
        return { destroyed: true }
      },
    }))
    const ids: string[] = []
    let cancelled = ''
    let rootRequestMs = 0
    const running = createSupervisor().run(
      {
        name: 'root',
        async act(_task, scope) {
          const budget = { maxTokens: 50, maxIterations: 5, deadlineMs: 8000 }
          const router = scope.spawn(inline, sentinel, { label: 'inline', budget })
          if (!router.ok) throw new Error('inline admission refused')
          ids.push(router.handle.id)
          await waitFor('model request', modelEntered.wait)
          expect(scope.send(router.handle.id, { steer: sentinel, interrupt: false })).toBe(true)
          const refused = scope.spawn(native, sentinel, { label: 'cancelled', budget })
          if (!refused.ok) throw new Error('queued native admission refused')
          cancelled = refused.handle.id
          refused.handle.abort()
          modelReply.release()
          const accepted = scope.spawn(native, sentinel, { label: 'native', budget })
          if (!accepted.ok) throw new Error('native admission refused')
          ids.push(accepted.handle.id)
          const promise = scope.spawn(silent, sentinel, { label: 'promise-process', budget })
          if (!promise.ok) throw new Error('Promise process admission refused')
          ids.push(promise.handle.id)
          const rootRequestStarted = performance.now()
          const rootTurn = await routerChatWithUsage(
            {
              routerBaseUrl: `${endpoint}/v1`,
              routerKey: 'offline-proof-key',
              model: 'offline-test-model',
            },
            [{ role: 'user', content: sentinel }],
          )
          rootRequestMs = performance.now() - rootRequestStarted
          if (!rootTurn.usage || rootTurn.billedCostUsd === undefined)
            throw new Error('HTTP model omitted its receipt')
          await scope.meter(
            {
              iterations: 1,
              tokens: rootTurn.usage,
              usd: rootTurn.billedCostUsd,
              ms: rootRequestMs,
            },
            { model: 'offline-test-model', privateDetail: sentinel },
          )
          const results = []
          for (let item = await scope.next(); item; item = await scope.next()) results.push(item)
          expect(results.filter((item) => item.kind === 'done')).toHaveLength(3)
          expect(results.find((item) => item.handle.id === cancelled)?.kind).toBe('down')
          workFinished.release()
          await rootReply.wait
          throw new Error(sentinel)
        },
      },
      null,
      {
        runId: 'live-trace',
        journal,
        blobs: new FileResultBlobStore(join(directory, 'blobs')),
        executors: createExecutorRegistry(),
        workerSlots: 1,
        interactiveBindingDir: directory,
        budget: { maxTokens: 1000, maxIterations: 50, deadlineMs: 10000 },
        hooks: {
          onEvent(event, context) {
            hooks.push(event)
            return recorder.hooks.onEvent?.(event, context)
          },
        },
      },
    )
    try {
      await waitFor('native admission', admissionEntered.wait)
      expect(hooks.filter((event) => event.target === 'agent.execution')).toEqual([])
      const beforeAck = await new FileSpawnJournal(join(directory, 'spawn-journal.jsonl')).loadTree(
        'live-trace',
      )
      const admitted = beforeAck!.find(
        (event) => event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
      )!
      expect(admitted).toBeDefined()
      admissionAck.release()
      await waitFor('completed work', workFinished.wait)
      expect(fixture.collectorAcknowledgements).toBe(0)
      expect(bodies.length).toBeGreaterThan(0)
      const nativeReceipt = JSON.parse(
        (await readFile(join(directory, 'native-receipts.jsonl'), 'utf8')).trim(),
      )
      expect(nativeReceipt.pid).not.toBe(process.pid)
      const executionHooks = hooks.filter((event) => event.target === 'agent.execution')
      expect(executionHooks).toHaveLength(1)
      expect(executionHooks[0]!.payload).toMatchObject({
        nodeId: admitted.id,
        controlRef: nativeReceipt.control,
        sessionId: nativeReceipt.control.sessionId,
      })
      expect(executionHooks.some((event) => event.parentId === cancelled)).toBe(false)
      collectorReply.release()
      rootReply.release()
      const result = await running
      expect(result).toMatchObject({ kind: 'no-winner', reason: 'driver-failed' })
      await recorder.finish({ result })
      expect(recorder.stats().dropped).toBe(0)
      const payload = JSON.stringify(bodies)
      expect(payload.includes(sentinel)).toBe(includeDetails)
      const spans = bodies.flatMap((body) => decodeOtlpTraceExport(body))
      expect(spans.filter((span) => span.attributes[ATTR.spanKind] === 'LLM')).toHaveLength(3)
      expect(
        spans.find((span) => span.attributes['tangle.supervise.node.id'] === cancelled)?.attributes,
      ).toMatchObject({ 'tangle.failure.code': 'aborted', 'tangle.failure.owner': 'caller' })
      if (result.kind !== 'no-winner' || result.reason !== 'driver-failed')
        throw new Error('root did not retain its failure')
      expect(spans.find((span) => span.name === 'supervisor.run')?.attributes).toMatchObject({
        'tangle.failure.code': result.error.failure!.code,
        'tangle.failure.owner': result.error.failure!.owner,
      })
      const rootMeter = hooks.find(
        (event) => event.target === 'agent.turn' && event.parentId === 'live-trace',
      )!
      const rootInference = spans.find(
        (span) =>
          span.attributes[ATTR.spanKind] === 'LLM' &&
          span.attributes['tangle.supervise.node.id'] === 'live-trace',
      )!
      expect(Number(rootInference.end_time_unix_nano) / 1e6).toBe(rootMeter.timestamp)
      expect(
        (Number(rootInference.end_time_unix_nano) - Number(rootInference.start_time_unix_nano)) /
          1e6,
      ).toBeCloseTo(rootRequestMs, 2)
      const tools = spans.filter((span) => span.attributes[ATTR.spanKind] === 'TOOL')
      expect(tools).toHaveLength(1)
      expect(tools[0]).toMatchObject({
        status_code: 2,
        attributes: { [ATTR.toolName]: 'remote', 'tool.call_id': 'remote-1' },
      })
      const rawSpans = bodies.flatMap((body) =>
        body.resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        ),
      )
      const steer = rawSpans.find((span) => span.name === 'agent.steer')!
      expect(decodeOtlpAttributes(steer.links![0]!.attributes).attributes[LINK_KIND_ATTR]).toBe(
        'steered_by',
      )
      const traceFile = join(directory, 'spans.otlp.jsonl')
      const traceWriter = createOpenInferenceFileExporter(traceFile)
      for (const span of rawSpans) traceWriter.exportSpan(span)
      await traceWriter.shutdown()
      const contractSpans = (await readFile(traceFile, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as ContractSpan)
      const validated = validateTraceSpans(contractSpans)
      expect(validated.ok).toBe(true)
      expect(validated.findings.filter((finding) => finding.code === 'unknown-span-kind')).toEqual(
        [],
      )
      expect(
        validated.capabilities.find((capability) => capability.name === 'tool-usage')?.available,
      ).toBe(true)
      const files = await readdir(join(directory, 'streams'))
      expect(files.sort()).toEqual(
        ids.map((id) => nodeStreamFile(id).slice('streams/'.length)).sort(),
      )
      const inlineRecords = (await readRootStream(directory, { nodeId: ids[0]! })) ?? []
      expect(
        inlineRecords.filter((row) => 'event' in row && row.event.kind === 'tool_result'),
      ).toHaveLength(1)
      expect(
        inlineRecords.filter((row) => 'event' in row && row.event.kind === 'text_delta'),
      ).toHaveLength(2)
      expect(await readFile(join(directory, nodeStreamFile(ids[2]!)), 'utf8')).toBe('')
    } finally {
      fixture.release()
      await running.catch(() => undefined)
      await recorder.finish()
      if (process.env.RUNTIME_TRACE_PROOF_DIR && !includeDetails) {
        await mkdir(process.env.RUNTIME_TRACE_PROOF_DIR, { recursive: true })
        await writeFile(
          join(process.env.RUNTIME_TRACE_PROOF_DIR, 'runtime-live.otlp.jsonl'),
          `${bodies.map((body) => JSON.stringify(body)).join('\n')}\n`,
        )
      }
      await fixture.close()
    }
  },
  15000,
)
