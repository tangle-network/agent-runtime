import assert from 'node:assert/strict'
import test from 'node:test'
import { zaiChatRaw } from './swe-jail'

test('zaiChatRaw preserves the SWE transport shape through Runtime', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  let requestUrl = ''
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input)
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'run', arguments: '{"command":"pwd"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 3 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  try {
    const result = await zaiChatRaw(
      { base: 'http://router.test/v1', key: 'secret', timeoutMs: 1_000 },
      {
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: 'inspect' }],
        tools: [
          {
            type: 'function',
            function: { name: 'run', parameters: { type: 'object' } },
          },
        ],
        tool_choice: 'required',
        temperature: 0.1,
        max_tokens: 32_768,
        thinking: { type: 'enabled' },
      },
      {
        name: 'swe-jail-test-worker',
        harness: 'cli-base',
        model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
        tools: { run: true },
      },
    )

    assert.equal(requestUrl, 'http://router.test/v1/chat/completions')
    assert.deepEqual(requestBody, {
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'inspect' }],
      tools: [
        {
          type: 'function',
          function: { name: 'run', parameters: { type: 'object' } },
        },
      ],
      tool_choice: 'required',
      temperature: 0.1,
      max_tokens: 32_768,
      thinking: { type: 'enabled' },
    })
    assert.equal(result.attempts, 1)
    assert.deepEqual(result.json, {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'run', arguments: '{"command":"pwd"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 3 },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('zaiChatRaw refuses a local profile error without entering the retry ladder', async () => {
  let fetchCalls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    fetchCalls += 1
    throw new Error('fetch must not run')
  }

  try {
    await assert.rejects(
      zaiChatRaw(
        {
          base: 'http://router.test/v1',
          key: 'secret',
          timeoutMs: 1_000,
          maxAttempts: 7,
        },
        { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'inspect' }] },
        {
          name: 'incomplete-worker',
          model: { provider: 'tangle-router', default: 'deepseek-v4-flash' },
        },
      ),
      /AgentProfile\.harness must be explicit/,
    )
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
