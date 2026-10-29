import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { data, Evaluator, Lexer, Parser } from '@actions/expressions'
import { expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

const exec = promisify(execFile)
const checker = resolve('scripts/check-npm-publication.mjs')

function evaluateWorkflow(expression: string, context: object, cancelled = false) {
  const functions = [
    { name: 'always', minArgs: 0, maxArgs: 0, call: () => new data.BooleanData(true) },
    { name: 'cancelled', minArgs: 0, maxArgs: 0, call: () => new data.BooleanData(cancelled) },
  ]
  const source = expression.startsWith('${{') ? expression.slice(3, -2) : expression
  const ast = new Parser(new Lexer(source).lex().tokens, ['needs', 'github'], functions).parse()
  const values = JSON.parse(JSON.stringify(context), data.reviver)
  if (!(values instanceof data.Dictionary)) throw new Error('Workflow context must be a dictionary')
  return new Evaluator(ast, values, new Map(functions.map((fn) => [fn.name, fn])))
    .evaluate()
    .coerceString()
}

async function checkRegistry(
  archiveStatus: number,
  options: {
    delayedArchive?: boolean
    corrupt?: boolean
    metadataStatus?: number
    metadataIntegrity?: string
    requirePublished?: boolean
    wrongCandidate?: boolean
    workflow?: boolean
    existing?: boolean
    packageKind?: 'runtime' | 'bench'
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-publication-'))
  const packageDirectory = join(directory, 'publication-package')
  const server = createServer()
  try {
    await mkdir(join(packageDirectory, 'package'), { recursive: true })
    await writeFile(
      join(packageDirectory, 'package/package.json'),
      JSON.stringify({
        name: `@tangle-network/${options.packageKind === 'bench' ? 'agent-bench' : 'agent-runtime'}`,
        version: '2.3.14',
      }),
    )
    await exec('tar', [
      '-czf',
      join(packageDirectory, 'package.tgz'),
      '-C',
      packageDirectory,
      'package',
    ])
    const bytes = await readFile(join(packageDirectory, 'package.tgz'))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No fixture HTTP address')
    const base = `http://127.0.0.1:${address.port}`
    let archiveReads = 0
    server.on('request', (req, res) => {
      if (req.url === '/metadata') {
        res.writeHead(options.metadataStatus ?? 200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            dist: {
              tarball: `${base}/package.tgz`,
              integrity:
                options.metadataIntegrity ??
                `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
            },
          }),
        )
      } else {
        archiveReads += 1
        res.writeHead(options.delayedArchive && archiveReads === 1 ? 404 : archiveStatus)
        res.end(
          archiveStatus === 200
            ? options.corrupt
              ? Buffer.from('wrong archive')
              : bytes
            : 'missing',
        )
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
    const output = join(directory, 'output')
    const env = {
      ...process.env,
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: directory,
      EXPECTED_SHA256: options.wrongCandidate
        ? '0'.repeat(64)
        : createHash('sha256').update(bytes).digest('hex'),
    }
    let result: { stdout: string; stderr: string }
    let artifact: string | undefined
    if (options.workflow) {
      const workflow = parse(await readFile(resolve('.github/workflows/publish.yml'), 'utf8'))
      const job = workflow.jobs['verify-publication']
      const bench = options.packageKind === 'bench'
      const context = {
        github: { ref: bench ? 'refs/tags/agent-bench-v2.3.14' : 'refs/heads/main' },
        needs: {
          qualify: {
            result: 'success',
            outputs: {
              'runtime-package-sha256': bench ? '' : env.EXPECTED_SHA256,
              'bench-package-sha256': bench ? env.EXPECTED_SHA256 : '',
              'runtime-publication-pending': 'false',
              'bench-publication-pending': 'false',
            },
          },
          'publish-npm': { result: options.existing || bench ? 'skipped' : 'success' },
          'publish-agent-bench': { result: options.existing || !bench ? 'skipped' : 'success' },
        },
      }
      if (evaluateWorkflow(job.if, context) !== 'true') {
        return { stdout: '', stderr: '', output: '', archiveReads, artifact, skipped: true }
      }
      artifact = `${evaluateWorkflow(job.env.PACKAGE, context)}-package`
      env.EXPECTED_SHA256 = evaluateWorkflow(job.env.EXPECTED_SHA256, context)
      const command = job.steps.find((step: { run?: string }) => step.run)?.run
      if (typeof command !== 'string') throw new Error('No actual publication verifier command')
      result = await exec('bash', ['-euc', command], {
        env: { ...env, NODE_OPTIONS: `--import ${loader}` },
      })
    } else {
      result = await exec(
        process.execPath,
        [
          '--import',
          loader,
          checker,
          packageDirectory,
          ...(options.requirePublished === false ? [] : ['--require-published']),
        ],
        { env },
      )
    }
    return {
      ...result,
      output: await readFile(output, 'utf8'),
      archiveReads,
      artifact,
      skipped: false,
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
    await rm(directory, { recursive: true, force: true })
  }
}

it('refuses matching metadata when its advertised archive is missing', async () => {
  await expect(checkRegistry(404)).rejects.toMatchObject({
    code: 3,
    stderr: expect.stringContaining('HTTP 404'),
  })
})

it('also refuses a missing archive during ordinary qualification', async () => {
  await expect(checkRegistry(404, { requirePublished: false })).rejects.toThrow(/HTTP 404/)
})

it('refuses wrong advertised bytes despite matching metadata integrity', async () => {
  await expect(checkRegistry(200, { corrupt: true, workflow: true })).rejects.toThrow(
    /differs from the qualified bytes/,
  )
})

it('runs the read-only workflow command against exact public bytes', async () => {
  expect((await checkRegistry(200, { workflow: true })).output).toBe('pending=false\n')
})

it('refuses postpublication metadata 404 instead of admitting publication', async () => {
  await expect(checkRegistry(404, { metadataStatus: 404 })).rejects.toMatchObject({
    code: 3,
    stderr: expect.stringContaining('HTTP 404'),
  })
})

it('retains the qualification artifact hash and strict registry integrity guards', async () => {
  await expect(checkRegistry(200, { wrongCandidate: true, workflow: true })).rejects.toThrow(
    /Qualified archive digest mismatch/,
  )
  await expect(checkRegistry(200, { metadataIntegrity: 'sha512-wrong' })).rejects.toThrow(
    /differs from the qualified bytes/,
  )
})

it('the workflow checker refuses authority on the read-only byte verifier', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-publish-policy-'))
  try {
    const original = await readFile(resolve('.github/workflows/publish.yml'), 'utf8')
    const path = join(directory, 'publish.yml')
    for (const mutation of ['id-token', 'npm-secret', 'persist-credentials']) {
      const workflow = parse(original)
      const job = workflow.jobs['verify-publication']
      if (mutation === 'id-token') job.permissions['id-token'] = 'write'
      if (mutation === 'npm-secret') job.env.NPM_TOKEN = 'forbidden-fixture-reference'
      if (mutation === 'persist-credentials') job.steps[0].with['persist-credentials'] = true
      await writeFile(path, stringify(workflow))
      await expect(
        exec(process.execPath, ['scripts/check-publish-workflow.mjs', path]),
      ).rejects.toThrow(/package identity token|publishing credentials|checkout credentials/)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('waits for a missing advertised archive and stops after verified bytes arrive', async () => {
  const result = await checkRegistry(200, { workflow: true, delayedArchive: true })
  expect(result.output).toBe('pending=false\n')
  expect(result.archiveReads).toBeGreaterThan(1)
}, 45_000)

it.each(['runtime', 'bench'] as const)(
  'verifies already-published %s even when both publishing jobs skip',
  async (packageKind) => {
    const result = await checkRegistry(200, { workflow: true, existing: true, packageKind })
    expect(result.skipped).toBe(false)
    expect(result.artifact).toBe(`agent-${packageKind}-package`)
    expect(result.output).toBe('pending=false\n')
    expect(result.archiveReads).toBeGreaterThan(0)
  },
)

it('refuses failed or cancelled qualification and publication job contexts', async () => {
  const workflow = parse(await readFile(resolve('.github/workflows/publish.yml'), 'utf8'))
  const expression = workflow.jobs['verify-publication'].if
  for (const job of ['qualify', 'publish-npm', 'publish-agent-bench']) {
    for (const state of ['failure', 'cancelled']) {
      const needs = {
        qualify: { result: 'success' },
        'publish-npm': { result: 'skipped' },
        'publish-agent-bench': { result: 'skipped' },
      }
      needs[job as keyof typeof needs].result = state
      expect(evaluateWorkflow(expression, { needs })).toBe('false')
    }
  }
  expect(
    evaluateWorkflow(
      expression,
      {
        needs: {
          qualify: { result: 'success' },
          'publish-npm': { result: 'skipped' },
          'publish-agent-bench': { result: 'skipped' },
        },
      },
      true,
    ),
  ).toBe('false')
})
