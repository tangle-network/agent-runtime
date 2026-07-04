import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatClient } from '@tangle-network/agent-eval'
import { afterAll, describe, expect, it } from 'vitest'
import { authorLoop } from './loop-author'

const outDir = mkdtempSync(join(tmpdir(), 'loop-author-'))
afterAll(() => rmSync(outDir, { recursive: true, force: true }))

/** Wrap module source in a ```ts fence (single-quoted so the backticks need no escaping). */
const fence = (code: string): string => '```ts\n' + code + '\n```'

/** A ChatClient that always replies with `content` — the authoring seam under test. */
function stubChat(content: string): ChatClient {
  return { chat: async () => ({ content }) } as unknown as ChatClient
}

const base = { goal: 'reach the check within budget', maxRounds: 3, outDir }

// A minimal module whose default export DUCK-TYPES a LoopDef (name + integer maxRounds + round
// fn) and imports nothing — so it loads without resolving the built package, letting us test the
// author → lint → write → import → validate path deterministically, no build required.
const validModule = `export default {
  name: 'demo-loop',
  maxRounds: 2,
  round: async ({ round }) => ({ out: { hits: round }, done: round >= 2 }),
  check: (out) => out.hits >= 2,
}`

describe('authorLoop: codemode over the loop atom', () => {
  it('authors + loads a LoopDef from a fenced module', async () => {
    const { loop, file, code } = await authorLoop({ ...base, chat: stubChat(fence(validModule)) })
    expect(loop.name).toBe('demo-loop')
    expect(loop.maxRounds).toBe(2)
    expect(typeof loop.round).toBe('function')
    expect(file.endsWith('.mts')).toBe(true)
    expect(code).toContain('demo-loop')
  })

  it('rejects a foreign import (the contract lint runs before load)', async () => {
    const bad = `import { readFileSync } from 'node:fs'\nexport default { name: 'x', maxRounds: 1, round: async () => ({ out: 1 }) }`
    await expect(authorLoop({ ...base, chat: stubChat(fence(bad)) })).rejects.toThrow(
      /foreign import|node builtin/,
    )
  })

  it('rejects out-of-band compute (fetch)', async () => {
    const bad = `export default { name: 'x', maxRounds: 1, round: async () => { await fetch('http://x'); return { out: 1 } } }`
    await expect(authorLoop({ ...base, chat: stubChat(fence(bad)) })).rejects.toThrow(
      /network access/,
    )
  })

  it('throws when the reply carries no code block', async () => {
    await expect(
      authorLoop({ ...base, chat: stubChat('here is a loop, no fence') }),
    ).rejects.toThrow(/no code block/)
  })

  it('rejects a module that does not default-export a LoopDef', async () => {
    const notALoop = `export default { notALoop: true }`
    await expect(authorLoop({ ...base, chat: stubChat(fence(notALoop)) })).rejects.toThrow(
      /does not default-export a LoopDef/,
    )
  })

  it('falls back to the named model when the primary author yields no code block', async () => {
    let call = 0
    const chat = {
      chat: async () => {
        call += 1
        return { content: call === 1 ? 'no fence here' : fence(validModule) }
      },
    } as unknown as ChatClient
    const { loop } = await authorLoop({
      ...base,
      chat,
      model: 'primary',
      fallbackModel: 'fallback',
    })
    expect(loop.name).toBe('demo-loop')
    expect(call).toBe(2) // primary failed, fallback succeeded
  })
})
