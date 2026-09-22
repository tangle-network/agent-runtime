import { describe, expect, it } from 'vitest'
import {
  createWorkerOutputReader,
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
    const read = createWorkerOutputReader(blobs)
    expect(
      await read('result', workerOutputReadOptions({ outputPath: ['result', 'content'] })),
    ).toEqual({ output: content })
  })

  it('selects only own fields and rejects missing paths', async () => {
    const blobs = { put: async () => {}, get: async () => ({ content: ['first', 'second'] }) }
    const read = createWorkerOutputReader(blobs)
    expect(await read('result', workerOutputReadOptions({ outputPath: ['content', '1'] }))).toEqual(
      { output: 'second' },
    )
    for (const outputPath of [['__proto__'], ['constructor'], ['content', '2'], ['missing']]) {
      await expect(read('result', workerOutputReadOptions({ outputPath }))).rejects.toThrow(
        'outputPath',
      )
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
    const read = createWorkerOutputReader(blobs)
    expect(await read('null', options)).toEqual({ output: null })
    expect(await read('missing', options)).toEqual({
      output: null,
      outputUnavailable: 'result-blob-missing',
    })
    expect(await read(undefined, options)).toEqual({ output: null })
  })

  it('reassembles escaped Unicode and terminal evidence without changing the retained artifact', async () => {
    const output = {
      content: 'Result: 🧪\\"\n'.repeat(12_000),
      events: [{ result: 'last evidence' }],
    }
    const encoded = JSON.stringify(output)
    const blobs = { put: async () => {}, get: async () => output }
    const read = createWorkerOutputReader(blobs)
    const chunks: string[] = []
    let offset = 0
    for (;;) {
      const reply = await read('result', workerOutputReadOptions({ outputOffset: offset }))
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

  it('reuses one encoded selection across pages and concurrent reads', async () => {
    let getCount = 0
    let serializationCount = 0
    let releaseGet!: () => void
    const getGate = new Promise<void>((resolve) => {
      releaseGet = resolve
    })
    const content = {
      toJSON: () => {
        serializationCount += 1
        return 'x'.repeat(512)
      },
    }
    const output = { content, events: ['unrelated'] }
    const blobs = {
      put: async () => {},
      get: async () => {
        getCount += 1
        await getGate
        return output
      },
    }
    const read = createWorkerOutputReader(blobs)
    const options = workerOutputReadOptions({ outputPath: ['content'], outputLimit: 128 })

    const first = read('result', { ...options, offset: 0 })
    const concurrent = read('result', { ...options, offset: 128 })
    releaseGet()
    const [firstPage, concurrentPage] = await Promise.all([first, concurrent])

    expect(getCount).toBe(1)
    expect(serializationCount).toBe(1)
    expect(firstPage.outputPage).toMatchObject({ offset: 0, nextOffset: 128 })
    expect(concurrentPage.outputPage).toMatchObject({ offset: 128, nextOffset: 256 })

    let offset: number | null = 256
    while (offset !== null) {
      const page = await read('result', { ...options, offset })
      offset = (page.outputPage as { nextOffset: number | null }).nextOffset
    }
    expect(getCount).toBe(1)
    expect(serializationCount).toBe(1)

    await expect(read('result', { ...options, offset: 0 })).resolves.toMatchObject({
      outputPage: { offset: 0, nextOffset: 128 },
    })
    expect(getCount).toBe(2)
    expect(serializationCount).toBe(2)
  })

  it('does not retain missing or rejected reads', async () => {
    let getCount = 0
    const output = { content: 'available after the first read' }
    const blobs = {
      put: async () => {},
      get: async () => {
        getCount += 1
        if (getCount === 1) return undefined
        if (getCount === 2) throw new Error('temporary blob failure')
        return output
      },
    }
    const read = createWorkerOutputReader(blobs)
    const options = workerOutputReadOptions({ outputPath: ['content'] })

    await expect(read('result', options)).resolves.toEqual({
      output: null,
      outputUnavailable: 'result-blob-missing',
    })
    await expect(read('result', options)).rejects.toThrow('temporary blob failure')
    await expect(read('result', options)).resolves.toEqual({ output: output.content })
    expect(getCount).toBe(3)
  })

  it('rejects invalid bounds and offsets beyond the result', async () => {
    for (const outputOffset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      expect(() => workerOutputReadOptions({ outputOffset })).toThrow('outputOffset')
    }
    for (const outputLimit of [0, 0.5, WORKER_OUTPUT_PAGE_CHARS + 1, '10']) {
      expect(() => workerOutputReadOptions({ outputLimit })).toThrow('outputLimit')
    }
    await expect(
      createWorkerOutputReader({ get: async () => 'x' })('x', {
        offset: 4,
        limit: 1,
        path: [],
      }),
    ).rejects.toThrow('outputOffset exceeds')
  })
})
