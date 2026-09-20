import { describe, expect, it } from 'vitest'
import {
  readWorkerOutput,
  WORKER_OUTPUT_PAGE_CHARS,
  workerOutputReadOptions,
} from './worker-output'

describe('retained worker output pages', () => {
  it('reads one retained field without serializing unrelated event history', async () => {
    const content = { finding: 'A checkable result' }
    const output = {
      result: { content },
      events: {
        toJSON() {
          throw new Error('event history must not be serialized')
        },
      },
    }
    const blobs = { put: async () => {}, get: async () => output }
    expect(
      await readWorkerOutput(
        blobs,
        'result',
        workerOutputReadOptions({ outputPath: ['result', 'content'] }),
      ),
    ).toEqual({ output: content })
  })

  it('selects only own fields and rejects missing paths', async () => {
    const blobs = { put: async () => {}, get: async () => ({ content: ['first', 'second'] }) }
    expect(
      await readWorkerOutput(
        blobs,
        'result',
        workerOutputReadOptions({ outputPath: ['content', '1'] }),
      ),
    ).toEqual({ output: 'second' })
    for (const outputPath of [['__proto__'], ['constructor'], ['content', '2'], ['missing']]) {
      await expect(
        readWorkerOutput(blobs, 'result', workerOutputReadOptions({ outputPath })),
      ).rejects.toThrow('outputPath')
    }
    for (const outputPath of ['content', [0], null]) {
      expect(() => workerOutputReadOptions({ outputPath })).toThrow('outputPath')
    }
  })

  it('keeps small typed values and distinguishes missing blobs from JSON null', async () => {
    const blobs = {
      put: async () => {},
      get: async (ref: string) => (ref === 'null' ? null : undefined),
    }
    const options = workerOutputReadOptions({})
    expect(await readWorkerOutput(blobs, 'null', options)).toEqual({ output: null })
    expect(await readWorkerOutput(blobs, 'missing', options)).toEqual({
      output: null,
      outputUnavailable: 'result-blob-missing',
    })
    expect(await readWorkerOutput(blobs, undefined, options)).toEqual({ output: null })
  })

  it('reassembles escaped Unicode and terminal evidence without changing the retained artifact', async () => {
    const output = {
      content: 'Result: 🧪\\"\n'.repeat(12_000),
      events: [{ result: 'last evidence' }],
    }
    const encoded = JSON.stringify(output)
    const blobs = { put: async () => {}, get: async () => output }
    const chunks: string[] = []
    let offset = 0
    for (;;) {
      const reply = await readWorkerOutput(
        blobs,
        'result',
        workerOutputReadOptions({ outputOffset: offset }),
      )
      const page = reply.outputPage as {
        text: string
        offset: number
        nextOffset: number | null
        totalChars: number
      }
      expect(reply.output).toBeNull()
      expect(page.offset).toBe(offset)
      expect(page.totalChars).toBe(encoded.length)
      expect(page.text.length).toBeLessThanOrEqual(WORKER_OUTPUT_PAGE_CHARS)
      expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThan(128 * 1024)
      chunks.push(page.text)
      if (page.nextOffset === null) break
      offset = page.nextOffset
    }
    expect(JSON.parse(chunks.join(''))).toEqual(output)
    expect(await blobs.get()).toBe(output)
  })

  it('rejects invalid bounds and offsets beyond the result', async () => {
    for (const outputOffset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      expect(() => workerOutputReadOptions({ outputOffset })).toThrow('outputOffset')
    }
    for (const outputLimit of [0, 0.5, WORKER_OUTPUT_PAGE_CHARS + 1, '10']) {
      expect(() => workerOutputReadOptions({ outputLimit })).toThrow('outputLimit')
    }
    await expect(
      readWorkerOutput({ put: async () => {}, get: async () => 'x' }, 'x', {
        offset: 4,
        limit: 1,
        path: [],
      }),
    ).rejects.toThrow('outputOffset exceeds')
  })
})
