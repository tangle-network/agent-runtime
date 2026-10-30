import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import { serveTopWeb } from '../../src/tui/top-web'

test('the default web viewer serves the complete owner-built asset closure from Runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-packaged-viewer-'))
  const installed = createRequire(import.meta.url)
  const source = dirname(installed.resolve('@tangle-network/sandbox-ui/workspace-viewer.js'))
  const packaged = resolve(dirname(installed.resolve('@tangle-network/agent-runtime/tui')), '../viewer')
  const files = [
    'workspace-viewer.js',
    'styles.css',
    'report-viewer.js',
    ...(await readdir(join(source, 'runtime-viewer'))).map((file) => `runtime-viewer/${file}`),
  ]
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(root, 'journal.jsonl'), '{"type":"launched"}\n')
  const web = await serveTopWeb({ roots: [root] })
  try {
    expect(await readFile(join(packaged, 'LICENSE'))).toEqual(await readFile(join(source, '../LICENSE')))
    for (const file of files) {
      const expected = digest(await readFile(join(source, file)))
      expect(digest(await readFile(join(packaged, file))), file).toBe(expected)
      const response = await fetch(`${web.url}assets/${file}`)
      expect(response.status, file).toBe(200)
      expect(digest(new Uint8Array(await response.arrayBuffer())), file).toBe(expected)
    }
    expect((await fetch(`${web.url}api/top`)).status).toBe(200)
  } finally {
    await web.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
