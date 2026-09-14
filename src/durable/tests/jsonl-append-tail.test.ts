import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareJsonlAppend } from '../jsonl-file'

vi.mock('node:fs/promises', async (load) => {
  const actual = await load<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile), open: vi.fn(actual.open) }
})

let root: string
beforeEach(async () => {
  const actual = await vi.importActual<typeof fs>('node:fs/promises')
  vi.mocked(fs.open).mockImplementation(actual.open)
  vi.mocked(fs.readFile).mockImplementation(actual.readFile)
  vi.clearAllMocks()
  root = await fs.mkdtemp(join(tmpdir(), 'journal-tail-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

describe('journal append tail recovery', () => {
  it('checks a healthy large journal without reading its history', async () => {
    const path = join(root, 'events.jsonl')
    await fs.writeFile(path, Buffer.alloc(16 * 1024 * 1024, 0x0a))
    const wholeRead = vi.spyOn(fs, 'readFile')
    const { open } = await vi.importActual<typeof fs>('node:fs/promises')
    let bytesRequested = 0
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args)
      const read = handle.read.bind(handle)
      vi.spyOn(handle, 'read').mockImplementation((...readArgs: any[]) => {
        bytesRequested += readArgs[2] ?? readArgs[0]?.byteLength ?? 0
        return (read as (...args: any[]) => any)(...readArgs)
      })
      return handle
    })
    expect(await prepareJsonlAppend(path)).toBe(false)
    expect(wholeRead).not.toHaveBeenCalled()
    expect(bytesRequested).toBe(1)
  })

  it('preserves a valid unterminated UTF-8 record spanning several read chunks', async () => {
    const path = join(root, 'events.jsonl')
    const bytes = `{"committed":true}\n${JSON.stringify({ text: 'é'.repeat(100_000) })}`
    await fs.writeFile(path, bytes)
    expect(await prepareJsonlAppend(path)).toBe(true)
    expect(await fs.readFile(path, 'utf8')).toBe(bytes)
  })

  it('truncates only a torn tail, retaining committed records byte for byte', async () => {
    const path = join(root, 'events.jsonl')
    const prefix = '{"first":1}\n{"second":2}\n'
    await fs.writeFile(path, `${prefix}{"text":"${'x'.repeat(150_000)}`)
    expect(await prepareJsonlAppend(path)).toBe(false)
    expect(await fs.readFile(path, 'utf8')).toBe(prefix)
  })

  it('retains a valid first record without a newline', async () => {
    const path = join(root, 'events.jsonl')
    await fs.writeFile(path, '{"first":true}')
    expect(await prepareJsonlAppend(path)).toBe(true)
    expect(await fs.readFile(path, 'utf8')).toBe('{"first":true}')
  })

  it('recovers a torn first record to an empty file', async () => {
    const path = join(root, 'events.jsonl')
    await fs.writeFile(path, '{"unfinished":')
    expect(await prepareJsonlAppend(path)).toBe(false)
    expect((await fs.stat(path)).size).toBe(0)
  })

  it('leaves an empty file and a missing path empty', async () => {
    const path = join(root, 'events.jsonl')
    expect(await prepareJsonlAppend(path)).toBe(false)
    await fs.writeFile(path, '')
    expect(await prepareJsonlAppend(path)).toBe(false)
    expect((await fs.stat(path)).size).toBe(0)
  })

  it('does not truncate valid evidence when allocating the recovery buffer fails', async () => {
    const path = join(root, 'events.jsonl')
    const bytes = '{"retained":true}'
    await fs.writeFile(path, bytes)
    const failure = new RangeError('fixture allocation failure')
    vi.spyOn(Buffer, 'concat').mockImplementationOnce(() => {
      throw failure
    })
    await expect(prepareJsonlAppend(path)).rejects.toBe(failure)
    expect(await fs.readFile(path, 'utf8')).toBe(bytes)
  })

  it('reads a recovered record completely even when filesystem reads are short', async () => {
    const path = join(root, 'events.jsonl')
    const bytes = '{"retained":true}'
    await fs.writeFile(path, bytes)
    const { open } = await vi.importActual<typeof fs>('node:fs/promises')
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args)
      const read = handle.read.bind(handle)
      vi.spyOn(handle, 'read').mockImplementation((...args: any[]) => {
        const [buffer, offset, length, position] = args
        return read(buffer, offset, Math.min(length, 3), position)
      })
      return handle
    })
    expect(await prepareJsonlAppend(path)).toBe(true)
    expect(await fs.readFile(path, 'utf8')).toBe(bytes)
  })
})
