import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishExclusiveDurableFile, writeAtomicDurableFile } from './durable-file'

let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('durable file helpers', () => {
  it('fsyncs complete exclusive contents and refuses to clobber a winner', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))
    const filePath = join(root, 'state.json')

    expect(publishExclusiveDurableFile(filePath, '{"winner":true}\n', { mode: 0o600 })).toBe(true)

    expect(readFileSync(filePath, 'utf8')).toBe('{"winner":true}\n')
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(publishExclusiveDurableFile(filePath, '{"winner":false}\n')).toBe(false)
    expect(readFileSync(filePath, 'utf8')).toBe('{"winner":true}\n')
  })

  it('fsyncs an atomic replacement and leaves no temporary publication file', () => {
    root = mkdtempSync(join(tmpdir(), 'agent-runtime-durable-file-'))
    const filePath = join(root, 'nested', 'state.json')
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, '{"generation":1}\n')

    writeAtomicDurableFile(filePath, '{"generation":2}\n', { mode: 0o600 })

    expect(readFileSync(filePath, 'utf8')).toBe('{"generation":2}\n')
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    expect(readdirSync(dirname(filePath))).toEqual(['state.json'])
  })
})
