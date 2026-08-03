import { describe, expect, it } from 'vitest'
import {
  checkJavaScript,
  checkPython,
  checkShell,
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
  })
})
