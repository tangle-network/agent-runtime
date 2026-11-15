/** Real OpenCode/materializer/process/session boundary; only the HTTP model peer is a fixture.
 * Opt in with the absolute path to the validated 2.3.0 binary. No external model is contacted. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { graphDesignerProfile } from '../../src/profiles/graph-designer'
import { profileOptimizerModelCall } from '../../src/runtime/profile-chat-client'

const binary = process.env.OPENCODE_NATIVE_TEST_BIN
it.skipIf(!binary)(
  'runs the native profile and consumes its exact skill through the real CLI',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-opencode-wire-'))
    const workspacePath = join(root, 'workspace')
    const configRoot = join(root, 'config')
    const requests: Array<Record<string, any>> = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404)
        response.end('Unknown fixture endpoint')
        return
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      requests.push(body)
      const index = requests.length
      const tool = index === 1
      const delta = tool
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'native-skill-call',
                type: 'function',
                function: { name: 'skill', arguments: JSON.stringify({ id: 'graph-author' }) },
              },
            ],
          }
        : { role: 'assistant', content: 'NATIVE_BOUNDARY_OK' }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const frame = (choices: unknown[], usage?: unknown) =>
        `data: ${JSON.stringify({
          id: `fixture-${index}`,
          object: 'chat.completion.chunk',
          created: 1_800_000_000,
          model: 'glm-5.3-flash-free',
          choices,
          ...(usage ? { usage } : {}),
        })}\n\n`
      response.write(frame([{ index: 0, delta, finish_reason: null }]))
      response.write(frame([{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }]))
      response.write(
        frame([], {
          prompt_tokens: 20,
          completion_tokens: 6,
          total_tokens: 26,
          prompt_tokens_details: { cached_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: 1 },
        }),
      )
      response.end('data: [DONE]\n\n')
    })
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (address === null || typeof address === 'string')
        throw new Error('Fixture has no TCP address')
      await mkdir(workspacePath)
      await mkdir(join(configRoot, 'opencode'), { recursive: true })
      // Transport/config fixture only. The model selection, prompt, grants and skill remain the
      // canonical profile. No output ceiling appears in this transport fixture.
      await writeFile(
        join(configRoot, 'opencode/opencode.json'),
        JSON.stringify({
          providers: {
            opencode: {
              name: 'Local boundary peer',
              env: ['NATIVE_TEST_API_KEY'],
              package: '@opencode/ai/providers/openai-compatible',
              settings: { baseURL: `http://127.0.0.1:${address.port}/v1` },
              models: { 'glm-5.3-flash-free': { name: 'Native test' } },
            },
          },
        }),
      )
      const skill = {
        kind: 'inline' as const,
        name: 'graph-author',
        content:
          '---\nname: graph-author\ndescription: native boundary fixture\n---\nReturn NATIVE_BOUNDARY_OK after checking the graph.',
      }
      const profile: AgentProfile = graphDesignerProfile({
        profile: {
          name: 'native-boundary',
          harness: 'opencode',
          model: {
            provider: 'opencode',
            default: 'opencode/glm-5.3-flash-free',
            maxVisibleOutputTokens: 17,
          },
          permissions: { '*': 'deny', skill: { '*': 'deny', 'graph-author': 'allow' } },
          prompt: { systemPrompt: 'Use the graph-author skill, then answer the request.' },
          resources: { skills: [skill] },
        },
      })
      const call = profileOptimizerModelCall({
        profile,
        context: 'real native boundary',
        executor: {
          backend: 'cli-in-place',
          workspacePath,
          outputFormat: 'native-session',
          harnessTimeoutMs: 60_000,
          env: {
            PATH: `${dirname(binary!)}:${process.env.PATH ?? ''}`,
            NATIVE_TEST_API_KEY: 'fixture-only',
            XDG_CONFIG_HOME: configRoot,
            XDG_DATA_HOME: join(root, 'data'),
            XDG_CACHE_HOME: join(root, 'cache'),
            XDG_STATE_HOME: join(root, 'state'),
          },
        },
      })
      const messages = [
        { role: 'system' as const, content: 'SYSTEM_CONTEXT_FIRST' },
        { role: 'user' as const, content: 'Previous question.' },
        { role: 'assistant' as const, content: 'Previous answer.' },
        { role: 'user' as const, content: 'Load the skill and return its answer.' },
      ]
      const run = await call({
        callId: 'native-boundary-proof',
        request: { model: 'opencode/glm-5.3-flash-free', maxTokens: 17, messages },
        signal: AbortSignal.timeout(90_000),
      })
      if (process.env.OPENCODE_NATIVE_TEST_EVIDENCE) {
        await writeFile(
          process.env.OPENCODE_NATIVE_TEST_EVIDENCE,
          JSON.stringify({ requests, run }, null, 2),
        )
      }
      expect(run.succeeded, JSON.stringify(run)).toBe(true)
      if (!run.succeeded) throw new Error(run.error)
      expect(run.response.content).toBe('NATIVE_BOUNDARY_OK')
      expect(run.response.servedModel).toBeNull()
      expect(run.response.costUsd).toBeNull()
      expect(requests).toHaveLength(2)
      for (const request of requests) {
        expect(request.max_tokens).toBe(17)
        expect(request.max_completion_tokens).toBeUndefined()
        expect(request.tools.map((tool: any) => tool.function.name)).toEqual(['skill'])
      }
      const projected = requests[0]!.messages.find((message: any) => message.role === 'user')
      expect(projected.content).toBe(
        [...profile.prompt!.instructions!, JSON.stringify({ messages })].join('\n\n'),
      )
      expect(run.execution).toMatchObject({
        nativeSession: {
          cliVersion: '2.3.0',
          status: 'completed',
          nativeModel: 'opencode/glm-5.3-flash-free',
          modelSource: 'turn-context',
          tokensKnown: true,
          visibleOutputLimit: {
            tokens: 17,
            wireField: 'max_tokens',
            scope: 'per-completion',
            observed: 'within-limit',
          },
          skillInvocations: [
            { id: 'graph-author', resourceDigest: canonicalCandidateDigest(skill) },
          ],
        },
      })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
  100_000,
)
