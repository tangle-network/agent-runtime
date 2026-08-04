import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkJavaScript,
  checkPython,
  checkShell,
  findSourceFiles,
} from './check-model-execution-boundary.mjs'

describe('model execution boundary source check', () => {
  it('rejects direct provider HTTP even when the endpoint is held in a variable', () => {
    const violations = checkJavaScript(
      'examples/direct.ts',
      `const endpoint = 'https://router.tangle.tools/v1/chat/completions'\nawait fetch(endpoint)`,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.location).toBe('2:7')
  })

  it('rejects provider SDK calls', () => {
    expect(
      checkJavaScript('examples/direct.ts', `await client.chat.completions.create({ model: 'x' })`),
    ).toHaveLength(1)
    expect(
      checkJavaScript('examples/direct.ts', `const client = new Anthropic({ apiKey: 'x' })`),
    ).toHaveLength(1)
  })

  it('rejects aliased provider SDK clients and responses.stream', () => {
    const violations = checkJavaScript(
      'examples/direct.ts',
      `import Client from 'openai'\nconst client = new Client({ apiKey: 'x' })\nawait client.responses.stream({ model: 'x' })`,
    )
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((violation) => violation.detail.includes('provider SDK import'))).toBe(
      true,
    )
  })

  it('rejects computed model URLs passed to fetch', () => {
    const violations = checkJavaScript(
      'examples/direct.ts',
      `const base = process.env.PROVIDER_URL\nconst route = '/v1/chat/' + 'completions'\nawait fetch(base + route)`,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.location).toBe('3:7')
  })

  it('rejects low-level Runtime model clients outside Runtime-owned adapters', () => {
    expect(
      checkJavaScript(
        'bench/direct.ts',
        `import { routerChatWithUsage as call } from '@tangle-network/agent-runtime/kernel'\nawait call(config, messages)`,
      ),
    ).toHaveLength(1)
    expect(
      checkJavaScript(
        'examples/direct-eval.ts',
        `import { createChatClient } from '@tangle-network/agent-eval'\ncreateChatClient({ transport: 'router', defaultModel: 'x' })`,
      ),
    ).toHaveLength(1)
    expect(
      checkJavaScript(
        'examples/direct-chat.ts',
        `import { chatCompletionsTransport } from '@tangle-network/agent-runtime/kernel'\nchatCompletionsTransport({ model: 'x' })`,
      ),
    ).toHaveLength(1)
    expect(
      checkJavaScript(
        'examples/direct-backend.ts',
        `import { createOpenAICompatibleBackend } from '@tangle-network/agent-runtime'\ncreateOpenAICompatibleBackend({ model: 'x', apiKey: 'key', baseUrl: 'https://router.test/v1' })`,
      ),
    ).toHaveLength(1)
    expect(
      checkJavaScript(
        'bench/direct-resolver.ts',
        `import { resolveAgentBackend as resolve } from '@tangle-network/agent-runtime'\nresolve({ kind: 'router', model: 'x' })`,
      ),
    ).toHaveLength(1)
  })

  it('rejects namespace and CommonJS aliases of low-level Runtime model clients', () => {
    expect(
      checkJavaScript(
        'bench/direct.ts',
        `import * as runtime from '@tangle-network/agent-runtime/kernel'\nawait runtime.routerBrain(config)`,
      ),
    ).toHaveLength(1)
    expect(
      checkJavaScript(
        'bench/direct.cjs',
        `const { routerToolLoop: run } = require('@tangle-network/agent-runtime/kernel')\nrun(config)`,
      ),
    ).toHaveLength(1)
    expect(
      checkJavaScript(
        'bench/direct.cjs',
        `const runtime = require('@tangle-network/agent-runtime/kernel')\nruntime['routerChatWithUsage'](config)`,
      ),
    ).toHaveLength(1)
  })

  it('rejects direct coding-agent CLI launches in JavaScript and TypeScript', () => {
    expect(
      checkJavaScript(
        'bench/claude.ts',
        `const args = ['-p', prompt, '--model', model]\nawait run('claude', args)`,
      ),
    ).toHaveLength(1)
    expect(
      checkJavaScript(
        'bench/opencode.ts',
        'await dotenvxBash(secrets, `cd ${cwd} && opencode --model ${model} run ${prompt}`)',
      ),
    ).toHaveLength(1)
    expect(
      checkJavaScript(
        'bench/sidecar.ts',
        'const command = `opencode --model ${model} --format json run ${prompt}`',
      ),
    ).toHaveLength(1)
    expect(
      checkJavaScript(
        'bench/terminal.ts',
        `const args = ['run', '--agent', 'opencode']\nawait runTb(args)`,
      ),
    ).toHaveLength(1)
  })

  it('rejects model execution hidden inside a custom CandidateGenerator callback', () => {
    const violations = checkJavaScript(
      'bench/custom-generator.ts',
      `import { runLocalHarness as launch } from '@tangle-network/agent-runtime/mcp'
const generator = {
  kind: 'direct-model',
  async generate({ worktreePath, findings }) {
    await launch({ harness: 'opencode', cwd: worktreePath, taskPrompt: String(findings) })
    return { applied: true, summary: 'changed' }
  },
} satisfies CandidateGenerator`,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.detail).toContain('launch(')
  })

  it('rejects publishing the low-level local harness executor', () => {
    const violations = checkJavaScript(
      'src/mcp/index.ts',
      `export { runLocalHarness, type RunLocalHarnessOptions } from './local-harness'`,
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.detail).toContain('public low-level model executor')
  })

  it('allows the one internal runLocalHarness owner', () => {
    expect(
      checkJavaScript(
        'src/mcp/worktree-harness.ts',
        `import { runLocalHarness } from './local-harness'\nawait runLocalHarness(options)`,
      ),
    ).toEqual([])
  })

  it('ignores comments, inert strings, and ordinary HTTP', () => {
    const source = `
      // fetch('https://api.openai.com/v1/chat/completions')
      const documentation = "client.responses.create({ model: 'x' })"
      await fetch('https://example.com/responses')
      await fetch('https://example.com/data')
    `
    expect(checkJavaScript('examples/ordinary.ts', source)).toEqual([])
  })

  it('allows a local fake endpoint only in a test file', () => {
    const source = `await fetch('http://127.0.0.1:43123/v1/chat/completions')`
    expect(checkJavaScript('tests/local.test.ts', source)).toEqual([])
    expect(checkJavaScript('examples/local.ts', source)).toHaveLength(1)
  })

  it('rejects executable Python and shell calls but ignores comments and docstrings', () => {
    expect(
      checkPython(`"""requests.post('/v1/chat/completions')"""\nclient.messages.create(model='x')`),
    ).toHaveLength(1)
    expect(checkPython(`# client.messages.create(model='x')`)).toEqual([])
    expect(checkShell(`# curl https://api.openai.com/v1/chat/completions`)).toEqual([])
    expect(checkShell(`curl https://api.openai.com/v1/chat/completions`)).toHaveLength(1)
    expect(checkPython(`command = f"opencode --model {model} run {task}"`)).toHaveLength(1)
    expect(checkShell(`opencode --model "$MODEL" run "$TASK"`)).toHaveLength(1)
    expect(checkShell(`# opencode --model "$MODEL" run "$TASK"`)).toEqual([])
  })

  it('allows non-inference CLI inspection', () => {
    expect(checkJavaScript('bench/auth.ts', `await exec('codex', ['login', 'status'])`)).toEqual([])
    expect(checkShell(`claude --version`)).toEqual([])
  })

  it('does not scan generated Python virtual environments', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'model-boundary-'))
    try {
      const virtualEnvironment = join(fixture, '.venv', 'lib')
      mkdirSync(virtualEnvironment, { recursive: true })
      writeFileSync(join(virtualEnvironment, 'provider.py'), `client.responses.create(model='x')`)
      const source = join(fixture, 'source.ts')
      writeFileSync(source, `export const value = 'source'\n`)

      expect(findSourceFiles(fixture)).toEqual([source])
    } finally {
      rmSync(fixture, { force: true, recursive: true })
    }
  })
})
