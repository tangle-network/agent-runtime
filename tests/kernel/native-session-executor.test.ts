import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LocalHarnessResult,
  RunLocalHarnessOptions,
} from '../../src/mcp/local-harness-process'
import { graphDesignerProfile } from '../../src/profiles/graph-designer'
import { profileChatClient, profileOptimizerModelCall } from '../../src/runtime/profile-chat-client'
import { createInPlaceCliExecutor } from '../../src/runtime/supervise/in-place-cli-executor'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const skill = {
  kind: 'inline' as const,
  name: 'graph-author',
  content:
    '---\nname: graph-author\ndescription: author checked graphs\n---\nUse checked graph results.',
}
const profile: AgentProfile = {
  name: 'native-graph-author',
  harness: 'opencode',
  model: { provider: 'opencode', default: 'opencode/glm-5.3-flash-free' },
  prompt: { systemPrompt: 'Load graph-author and answer the complete request.' },
  resources: { skills: [skill] },
}
const sessionId = 'ses_fixture'
function result(stdout: string, exitCode = 0): LocalHarnessResult {
  return { exitCode, stdout, stderr: '', killedBySignal: null, durationMs: 1, timedOut: false }
}

async function fixture(change?: (value: Record<string, any>) => void) {
  const workspacePath = await mkdtemp(join(tmpdir(), 'native-session-'))
  directories.push(workspacePath)
  const selected = { id: 'glm-5.3-flash-free', providerID: 'opencode', variant: 'default' }
  const exported: Record<string, any> = {
    info: {
      id: sessionId,
      location: { directory: workspacePath },
      model: selected,
      outcome: 'succeeded',
      tokens: { input: 11, output: 3, reasoning: 5, cache: { read: 7, write: 2 } },
      cost: 0,
    },
    messages: [
      {
        id: 'earlier',
        type: 'assistant',
        model: selected,
        time: { completed: 1 },
        finish: 'tool-calls',
        tokens: { input: 4, output: 1, reasoning: 2, cache: { read: 1, write: 1 } },
        content: [
          { type: 'text', text: 'Earlier commentary must not be the answer.' },
          {
            type: 'tool',
            id: 'skill-call',
            name: 'skill',
            state: {
              status: 'completed',
              input: { id: 'graph-author' },
              metadata: {
                name: 'graph-author',
                directory: join(workspacePath, '.opencode/skills/graph-author'),
              },
              content: [
                {
                  type: 'text',
                  text: `<skill_content name="graph-author">\n# Skill: graph-author\n\nUse checked graph results.\n\nBase directory for this skill: ${join(workspacePath, '.opencode/skills/graph-author')}\nRelative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.\nNote: file list is sampled.\n\n<skill_files>\n\n</skill_files>\n</skill_content>`,
                },
              ],
            },
          },
        ],
      },
      {
        id: 'final',
        type: 'assistant',
        model: selected,
        time: { completed: 2 },
        finish: 'stop',
        tokens: { input: 7, output: 2, reasoning: 3, cache: { read: 6, write: 1 } },
        content: [{ type: 'text', text: 'Checked answer.' }],
      },
      { id: 'idle', type: 'idle', outcome: 'succeeded' },
    ],
  }
  change?.(exported)
  const runHarness = vi.fn(async (options: RunLocalHarnessOptions) => {
    if (options.invocation?.args[0] === '--version') return result('opencode v2.3.0\n')
    if (options.invocation?.args[0] === 'session') {
      expect(options.invocation.args).toEqual(['session', 'export', sessionId, '--standalone'])
      return result(JSON.stringify(exported))
    }
    expect(options.cwd).toBe(workspacePath)
    const agentIndex = options.invocation?.args.indexOf('--agent') ?? -1
    if (agentIndex >= 0) {
      exported.info.agent ??= options.invocation?.args[agentIndex + 1]
      for (const message of exported.messages)
        if (message.type === 'assistant') message.agent ??= exported.info.agent
    }
    expect(options.invocation?.args).toContain('--standalone')
    expect(options.invocation?.args).toContain('json')
    expect(options.invocation?.args).toContain('--title')
    expect(options.invocation?.args).toContain('opencode/glm-5.3-flash-free')
    const mounted = await readFile(
      join(workspacePath, '.opencode/skills/graph-author/SKILL.md'),
      'utf8',
    )
    expect(mounted).toContain('Use checked graph results.')
    return result(
      `${JSON.stringify({ type: 'step_start', sessionID: sessionId })}\n`,
      exported.info.outcome === 'succeeded' ? 0 : 1,
    )
  })
  const executor = {
    backend: 'cli-in-place' as const,
    workspacePath,
    outputFormat: 'native-session' as const,
    harnessTimeoutMs: 10_000,
    runHarness,
  }
  return { workspacePath, executor, runHarness, exported }
}

describe('OpenCode native-session exact profile route', () => {
  it('carries the complete graph designer composition through native admission', async () => {
    const { executor, workspacePath, runHarness } = await fixture()
    const completeProfile = graphDesignerProfile({ profile })
    const call = profileOptimizerModelCall({
      profile: completeProfile,
      context: 'complete graph designer',
      executor: {
        ...executor,
        runHarness: async (options) => {
          if (options.invocation?.args[0] === 'run') {
            const flags = options.invocation.args
            const selected = flags[flags.indexOf('--agent') + 1]!
            const primary = await readFile(
              join(workspacePath, `.opencode/agents/${selected}.md`),
              'utf8',
            )
            const frontmatter = /^---\n([\s\S]*?)\n---\n/u.exec(primary)?.[1]
            expect(frontmatter?.split('\n')).toContain(
              `description: ${JSON.stringify(completeProfile.description)}`,
            )
            for (const resource of completeProfile.resources!.skills!) {
              expect(
                await readFile(
                  join(workspacePath, `.opencode/skills/${resource.name}/SKILL.md`),
                  'utf8',
                ),
              ).toBe(resource.kind === 'inline' ? resource.content : undefined)
            }
          }
          return runHarness(options)
        },
      },
    })
    const run = await call({
      callId: 'complete-graph-designer',
      request: {
        model: profile.model!.default!,
        messages: [{ role: 'user', content: 'Author the requested checked graph.' }],
      },
      signal: AbortSignal.timeout(30_000),
    })
    expect(run.succeeded, JSON.stringify(run)).toBe(true)
  })

  it('refuses description text without a bound native primary agent before dispatch', async () => {
    const { executor } = await fixture()
    expect(() =>
      profileOptimizerModelCall({
        profile: { ...profile, description: 'Must survive.', prompt: undefined },
        executor,
      }),
    ).toThrow('did not preserve profile.description')
  })

  it('uses full materialization and native attribution without inventing served identity or billing', async () => {
    const { executor } = await fixture()
    const call = profileOptimizerModelCall({ profile, executor, context: 'native fixture' })
    const run = await call({
      callId: 'native-call',
      request: {
        model: profile.model!.default!,
        messages: [{ role: 'user', content: 'Write the graph.' }],
      },
      signal: AbortSignal.timeout(30_000),
    })
    expect(run.succeeded).toBe(true)
    if (!run.succeeded) throw new Error(run.error)
    expect(run.response.content).toBe('Checked answer.')
    expect(run.response.model).toBe('opencode/glm-5.3-flash-free')
    expect(run.response.servedModel).toBeNull()
    expect(run.response.costUsd).toBeNull()
    expect(run.response.usage).toMatchObject({
      promptTokens: 18,
      completionTokens: 8,
      reasoningTokens: 5,
    })
    expect(run.receipt).toMatchObject({
      inputTokens: 11,
      cachedTokens: 7,
      outputTokens: 8,
      costUnknown: true,
    })
    expect(run.execution).toMatchObject({
      model: null,
      servedModel: null,
      nativeSession: {
        nativeModel: profile.model!.default,
        modelSource: 'turn-context',
        billedCostUsd: null,
        skillInvocations: [
          {
            id: 'graph-author',
            name: 'graph-author',
            resourceDigest: canonicalCandidateDigest(skill),
          },
        ],
      },
    })
  })

  it('preserves a provider quota failure and default zero tokens as unknown', async () => {
    const nativeError = {
      type: 'provider.free-limit',
      message: 'Free usage limit reached.',
      status: 429,
      retryAfterMs: 85_201_000,
    }
    const { executor } = await fixture((value) => {
      value.info.outcome = 'failed'
      value.info.tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      value.messages[1].finish = 'error'
      value.messages[1].error = nativeError
      value.messages[1].content = []
    })
    const call = profileOptimizerModelCall({ profile, executor, context: 'quota fixture' })
    const run = await call({
      callId: 'quota-call',
      request: { model: profile.model!.default!, messages: [{ role: 'user', content: 'Task' }] },
      signal: AbortSignal.timeout(30_000),
    })
    expect(run.succeeded).toBe(false)
    expect(run.receipt).toMatchObject({ usageUnknown: true, costUnknown: true })
    expect(run.execution).toMatchObject({
      executed: true,
      model: null,
      nativeSession: { status: 'failed', tokensKnown: false, nativeError },
    })
  })

  it.each(['location', 'model', 'agent', 'terminal'] as const)(
    'rejects a native %s mismatch',
    async (kind) => {
      const { executor } = await fixture((value) => {
        if (kind === 'location') value.info.location.directory = '/unrelated-workspace'
        if (kind === 'agent') value.info.agent = 'unmaterialized-agent'
        if (kind === 'model') {
          value.info.model = { id: 'other-model', providerID: 'opencode' }
          for (const msg of value.messages)
            if (msg.type === 'assistant') msg.model = value.info.model
        }
        if (kind === 'terminal') delete value.info.outcome
      })
      const client = profileChatClient({ profile, executor, context: 'native mismatch' })
      await expect(client.chat({ messages: [{ role: 'user', content: 'Task' }] })).rejects.toThrow()
    },
  )

  it('refuses an unenforced ChatClient output ceiling before any CLI work', async () => {
    const { executor, runHarness } = await fixture()
    const client = profileChatClient({ profile, executor, context: 'native output bound' })
    await expect(
      client.chat({ messages: [{ role: 'user', content: 'Task' }], maxTokens: 4096 }),
    ).rejects.toThrow(/maxTokens/u)
    expect(runHarness).not.toHaveBeenCalled()
  })

  it('does not report complete usage when a billable response omitted its tokens', async () => {
    const { executor } = await fixture((value) => {
      delete value.messages[0].tokens
    })
    const client = profileChatClient({ profile, executor, context: 'partial native usage' })
    const response = await client.chat({ messages: [{ role: 'user', content: 'Task' }] })
    expect(response.usage.captured).toBe(false)
    expect(response.costUsd).toBeNull()
  })

  it.each(['normalized-zero', 'reused-pending', 'reused-failed'] as const)(
    'retains partial native usage without qualifying %s counters',
    async (kind) => {
      const { executor } = await fixture((value) => {
        if (kind === 'normalized-zero') {
          value.info.tokens = { input: 11, output: 3, reasoning: 0, cache: { read: 0, write: 0 } }
          value.messages[0].tokens = {
            input: 4,
            output: 1,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          }
          value.messages[1].tokens = {
            input: 7,
            output: 2,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          }
        } else if (kind === 'reused-pending') {
          delete value.messages[0].time.completed
          delete value.messages[0].finish
        } else {
          value.messages[0].finish = 'error'
          value.messages[0].error = { type: 'provider.failed', message: 'Retried response failed.' }
        }
      })
      const call = profileOptimizerModelCall({
        profile,
        executor,
        context: 'unknown native classes',
      })
      const run = await call({
        callId: kind,
        request: { model: profile.model!.default!, messages: [{ role: 'user', content: 'Task' }] },
        signal: AbortSignal.timeout(30_000),
      })
      expect(run.succeeded).toBe(true)
      if (!run.succeeded) throw new Error(run.error)
      expect(run.response.usage.captured).toBe(false)
      expect(run.receipt).toMatchObject({ usageUnknown: true, costUnknown: true })
      expect(run.execution).toMatchObject({ nativeSession: { tokensKnown: false } })
      if (kind === 'normalized-zero') {
        expect(run.execution).toMatchObject({
          nativeSession: {
            usage: {
              input: null,
              output: null,
              freshInput: 11,
              visibleOutput: 3,
              reasoningOutput: null,
              cachedInput: null,
              cacheWriteInput: null,
            },
          },
        })
        expect(run.response.usage.reasoningTokens).toBeUndefined()
        expect(run.response.usage.cachedPromptTokens).toBeUndefined()
      }
    },
  )

  it('refuses a provider response exceeding the native visible cap while retaining spend', async () => {
    const { executor } = await fixture()
    const capped = { ...profile, model: { ...profile.model, maxVisibleOutputTokens: 1 } }
    const call = profileOptimizerModelCall({
      profile: capped,
      executor,
      context: 'native output overshoot',
    })
    const run = await call({
      callId: 'overshoot',
      request: {
        model: profile.model!.default!,
        maxTokens: 1,
        messages: [{ role: 'user', content: 'Task' }],
      },
      signal: AbortSignal.timeout(30_000),
    })
    expect(run.succeeded).toBe(false)
    expect(run.receipt).toMatchObject({ inputTokens: 11, outputTokens: 8 })
    expect(run.execution).toMatchObject({
      nativeSession: { visibleOutputLimit: { observed: 'exceeded' } },
    })
  })

  it.each(['maxTotalOutputTokens', 'maxReasoningTokens'] as const)(
    'refuses unsupported %s before CLI work',
    async (field) => {
      const { executor, runHarness } = await fixture()
      const capped = { ...profile, model: { ...profile.model, [field]: 20 } }
      expect(() =>
        profileOptimizerModelCall({ profile: capped, executor, context: 'native preflight' }),
      ).toThrow(/drop axis/u)
      expect(runHarness).not.toHaveBeenCalled()
    },
  )

  it.each([
    { provider: 'opencode', default: 'other/glm-5.3-flash-free' },
    { provider: 'opencode', default: 'opencode/glm-5.3-flash-free#high' },
    { provider: 'other', default: 'other/model', maxVisibleOutputTokens: 17 },
  ])('refuses unqualified model/variant cap controls before binding', async (model) => {
    const { executor, runHarness } = await fixture()
    expect(() =>
      profileOptimizerModelCall({
        profile: { ...profile, model },
        executor,
        context: 'native route preflight',
      }),
    ).toThrow(/native-session/u)
    expect(runHarness).not.toHaveBeenCalled()
  })

  it('does not qualify a different skill body under the same name', async () => {
    const { executor } = await fixture((value) => {
      value.messages[0].content[1].state.content[0].text = 'A different skill.'
    })
    const output = await createInPlaceCliExecutor({ ...executor, profile }).execute(
      'Task',
      AbortSignal.timeout(30_000),
    )
    expect(output.out.nativeSession?.skillInvocations[0]?.resourceDigest).toBeUndefined()
  })

  it('refuses an unvalidated CLI version before inference', async () => {
    const { executor, runHarness } = await fixture()
    runHarness.mockImplementation(async () => result('2.4.0\n'))
    await expect(
      createInPlaceCliExecutor({ ...executor, profile }).execute(
        'Task',
        AbortSignal.timeout(30_000),
      ),
    ).rejects.toThrow(/validated OpenCode 2.3.0/u)
    expect(runHarness).toHaveBeenCalledTimes(1)
  })
})
