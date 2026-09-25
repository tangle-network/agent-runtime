/**
 * A router-brained agent keeps its conversation: each turn's `agent.turn` event carries what the
 * turn added while the run is live, and the agent settles with an `available` transcript receipt
 * that holds the whole conversation once, in order (agent-runtime#1377).
 */
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { HarnessTranscriptArtifact } from '../../src/runtime/harness-transcript'
import { harnessTranscriptFromLines } from '../../src/runtime/harness-transcript'
import {
  createRouterTranscript,
  TURN_CONTENT_BYTES,
} from '../../src/runtime/supervise/router-transcript'
import { supervise } from '../../src/runtime/supervise/supervise'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations } from './test-agent-profile'

const model = { provider: 'tangle-router', default: 'offline-model' } as const

interface ChatMessage {
  readonly role: string
  readonly content?: unknown
  readonly tool_calls?: ReadonlyArray<{ readonly id: string; readonly function: { name: string } }>
  readonly tool_call_id?: string
}

/** A manager at level 0 or 1 spawns two children and awaits them; a level-2 agent answers. */
function brain() {
  let call = 0
  return async (body: Record<string, unknown>) => {
    call += 1
    const messages = body.messages as ReadonlyArray<ChatMessage>
    const task = messages.map((message) => String(message.content ?? '')).join('\n')
    const level = Number(/level=(\d+)/u.exec(task)?.[1] ?? 0)
    const reply = (message: Record<string, unknown>) => ({
      model: 'offline-model',
      choices: [{ message, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0 },
    })
    if (level === 2) return reply({ content: `answer at level ${level}` })
    const names = new Map<string, string>()
    for (const message of messages) {
      for (const tool of message.tool_calls ?? []) names.set(tool.id, tool.function.name)
    }
    const spawned = [...names.values()].filter((name) => name === 'spawn_worker').length
    const settled = messages.filter(
      (message) =>
        message.role === 'tool' &&
        names.get(message.tool_call_id ?? '') === 'await_event' &&
        /"status":"(done|down)"/u.test(String(message.content)),
    ).length
    if (spawned === 0) {
      return reply({
        content: `level ${level} splits the work`,
        tool_calls: [0, 1].map((index) => ({
          id: `spawn-${level}-${index}-${call}`,
          type: 'function',
          function: {
            name: 'spawn_worker',
            arguments: JSON.stringify({
              profile: {
                name: `agent-${level + 1}`,
                harness: 'cli-base',
                model,
                // The answering level is an explicit leaf, the router tools executor.
                ...(level + 1 === 2
                  ? { tools: { agent_runtime_coordination_spawn_worker: false } }
                  : {}),
              } satisfies AgentProfile,
              task: `level=${level + 1} part=${index}`,
            }),
          },
        })),
      })
    }
    if (settled < 2) {
      return reply({
        content: null,
        tool_calls: [
          {
            id: `await-${level}-${call}`,
            type: 'function',
            function: { name: 'await_event', arguments: '{}' },
          },
        ],
      })
    }
    return reply({ content: `level ${level} done` })
  }
}

function settledEvents(
  journal: InMemorySpawnJournal,
): Array<Extract<SpawnEvent, { kind: 'settled' }>> {
  const trees = (journal as unknown as { trees: Map<string, { events: SpawnEvent[] }> }).trees
  return [...trees.values()]
    .flatMap((tree) => tree.events)
    .filter((event): event is Extract<SpawnEvent, { kind: 'settled' }> => event.kind === 'settled')
}

const lines = (artifact: HarnessTranscriptArtifact) =>
  artifact.files
    .flatMap((file) => file.content.split('\n').filter(Boolean))
    .map((line) => JSON.parse(line))

describe('a router-brained agent keeps its conversation', () => {
  it('streams each turn and settles every agent of a depth-2 tree with its whole conversation', async () => {
    const router = {
      routerBaseUrl: 'http://offline.invalid/v1',
      routerKey: 'offline',
      complete: brain(),
    }
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const turns = new Map<string, Array<Record<string, unknown>>>()
    const result = await supervise(
      {
        name: 'root',
        harness: 'cli-base',
        model,
        tools: runtimeToolDeclarations('spawn_worker', 'await_event'),
      },
      'level=0',
      {
        budget: { maxIterations: 400, maxTokens: 4_000_000 },
        router,
        backend: { backend: 'router', ...router },
        deliverable: { check: () => true, describe: 'any answer' },
        awaitTimeoutMs: 60_000,
        journal,
        blobs,
        runId: 'router-transcript',
        hooks: {
          onEvent: (event) => {
            if (event.target !== 'agent.turn' || event.parentId === undefined) return
            const added = (event.payload as { conversation?: Array<Record<string, unknown>> })
              .conversation
            if (!added) return
            turns.set(event.parentId, [...(turns.get(event.parentId) ?? []), ...added])
          },
        },
      },
    )
    expect(result.kind, JSON.stringify(result).slice(0, 600)).toBe('winner')

    // Two managers below the root, four answering agents below them: every one settles with its
    // conversation, none as `executor-exposes-no-transcript`.
    const settled = settledEvents(journal).filter((event) => event.id !== 'router-transcript')
    expect(settled).toHaveLength(6)
    for (const event of settled) {
      expect(event.harnessTranscript).toMatchObject({
        status: 'available',
        harness: 'router',
        fileCount: 1,
        skippedCount: 0,
      })
    }

    const manager = settled.find((event) => event.id === 'router-transcript:s0')
    if (manager?.harnessTranscript?.status !== 'available') throw new Error('expected a receipt')
    const conversation = lines(
      (await blobs.get(manager.harnessTranscript.transcriptRef)) as HarnessTranscriptArtifact,
    )
    // The seed, the reply with both spawn calls and their arguments, each spawn result, the waits,
    // and the final answer: each once, in the order the model saw them.
    expect(conversation.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'tool',
      ...conversation.slice(5, -1).map((message) => message.role),
      'assistant',
    ])
    expect(conversation[1].content).toContain('level=1 part=0')
    expect(conversation[2].content).toBe('level 1 splits the work')
    expect(
      conversation[2].tool_calls.map(
        (call: { function: { arguments: string } }) => JSON.parse(call.function.arguments).task,
      ),
    ).toEqual(['level=2 part=0', 'level=2 part=1'])
    expect(conversation.at(-1)).toEqual({ role: 'assistant', content: 'level 1 done' })
    expect(
      conversation.filter(
        (message) => message.role === 'assistant' && message.content === 'level 1 splits the work',
      ),
    ).toHaveLength(1)

    // The turn events carried the same conversation while the run was live: everything up to the
    // last reply (the settled transcript also holds nothing after it here).
    expect(turns.get('router-transcript:s0')).toEqual(conversation)
  }, 60_000)
})

describe('createRouterTranscript', () => {
  it('keeps the loop copy of a reply once, the tool results, and a compaction note', () => {
    const recorder = createRouterTranscript()
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]
    recorder.observe(messages)
    const first = recorder.reply({
      content: 'thinking',
      toolCalls: [{ id: 'a', name: 'read', arguments: '{"p":1}' }],
    })
    expect(first.map((message) => message.role)).toEqual(['system', 'user', 'assistant'])
    // The loop appends its own copy of the reply and the tool result; a compaction then folds the
    // middle into a note before the next call.
    messages.push(
      { role: 'assistant', content: 'thinking', tool_calls: [] },
      { role: 'tool', tool_call_id: 'a', content: 'r' },
    )
    recorder.observe(messages)
    messages.splice(2, 2, { role: 'user', content: 'note' })
    recorder.observe(messages)
    const second = recorder.reply({ content: 'done' })
    expect(second).toEqual([
      { role: 'tool', tool_call_id: 'a', content: 'r' },
      { role: 'user', content: 'note' },
      { role: 'assistant', content: 'done' },
    ])
    const capture = recorder.capture()
    if (capture.status !== 'captured') throw new Error('expected a capture')
    expect(lines(capture.artifact).map((message) => message.content)).toEqual([
      's',
      'u',
      'thinking',
      'r',
      'note',
      'done',
    ])
  })

  it('cuts a long content in the turn event and says so, and keeps it whole in the capture', () => {
    const recorder = createRouterTranscript()
    const long = 'x'.repeat(TURN_CONTENT_BYTES + 10)
    recorder.observe([{ role: 'user', content: long }])
    const [cut] = recorder.reply({ content: 'ok' })
    expect(cut).toMatchObject({ contentBytes: TURN_CONTENT_BYTES + 10, contentCut: true })
    expect(String(cut?.content)).toHaveLength(TURN_CONTENT_BYTES)
    const capture = recorder.capture()
    if (capture.status !== 'captured') throw new Error('expected a capture')
    expect(lines(capture.artifact)[0].content).toBe(long)
  })

  it('names an agent that never took a turn', () => {
    expect(createRouterTranscript().capture()).toEqual({
      status: 'unavailable',
      reason: 'execution-never-started',
    })
  })
})

describe('harnessTranscriptFromLines', () => {
  it('fills 2 MiB files in order, and names a line too long for one file and every line past 16 MiB', () => {
    const mib = 1024 * 1024
    const big = 'y'.repeat(mib - 1) // with its newline, exactly 1 MiB
    const capture = harnessTranscriptFromLines('router', 'conversation', [
      big,
      big,
      'z'.repeat(2 * mib),
      ...Array.from({ length: 15 }, () => big),
    ])
    if (capture.status !== 'captured') throw new Error('expected a capture')
    expect(capture.totalBytes).toBe(16 * mib)
    expect(capture.artifact.files.map((file) => [file.path, file.bytes])).toEqual(
      Array.from({ length: 8 }, (_, index) => [`conversation-00${index}.jsonl`, 2 * mib]),
    )
    expect(capture.artifact.skipped).toEqual([
      { path: 'conversation line 3', reason: 'file-exceeds-byte-bound' },
      { path: 'conversation line 18', reason: 'total-byte-budget-exhausted' },
    ])
  })
})
