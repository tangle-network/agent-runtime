import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const exec = promisify(execFile)
const checker = resolve('scripts/check-npm-publication.mjs')

async function checkRegistry(archiveStatus: number) {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-publication-'))
  const server = createServer()
  try {
    await mkdir(join(directory, 'package'))
    await writeFile(
      join(directory, 'package/package.json'),
      JSON.stringify({ name: '@tangle-network/agent-runtime', version: '2.3.14' }),
    )
    await exec('tar', ['-czf', join(directory, 'package.tgz'), '-C', directory, 'package'])
    const bytes = await readFile(join(directory, 'package.tgz'))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No fixture HTTP address')
    const base = `http://127.0.0.1:${address.port}`
    server.on('request', (req, res) => {
      if (req.url === '/metadata') {
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            dist: {
              tarball: `${base}/package.tgz`,
              integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
            },
          }),
        )
      } else {
        res.writeHead(archiveStatus)
        res.end(archiveStatus === 200 ? bytes : 'missing')
      }
    })
    const loader = join(directory, 'registry.mjs')
    // Redirect the third-party origin only; the unmodified CLI reads real HTTP responses.
    await writeFile(
      loader,
      `const upstream = globalThis.fetch;
      globalThis.fetch = (url, options) => upstream(
        String(url).startsWith('https://registry.npmjs.org/') ? ${JSON.stringify(`${base}/metadata`)} : url, options);
    `,
    )
    return await exec(
      process.execPath,
      ['--import', loader, checker, directory, '--require-published'],
      {
        env: { ...process.env, GITHUB_OUTPUT: join(directory, 'output') },
      },
    )
  } finally {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
    await rm(directory, { recursive: true, force: true })
  }
}

it('refuses matching metadata when its advertised archive is missing', async () => {
  await expect(checkRegistry(404)).rejects.toThrow(/HTTP 404/)
})
