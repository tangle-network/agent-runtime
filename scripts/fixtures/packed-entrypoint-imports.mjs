
        const { readFileSync } = await import('node:fs')
        const packageJson = JSON.parse(
          readFileSync('node_modules/@tangle-network/agent-runtime/package.json', 'utf8'),
        )
        for (const subpath of ['graph', 'primeintellect', 'conversation', 'knowledge', 'environment-provider']) {
          try {
            await import(packageJson.name + '/' + subpath)
            throw new Error('removed subpath still imports: ' + subpath)
          } catch (error) {
            if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
          }
        }
        const root = await import(packageJson.name)
        for (const name of ['buildAgentCandidateBundle', 'computeBackoff', 'turnId']) {
          if (name in root) throw new Error('removed root export returned: ' + name)
        }
        for (const subpath of Object.keys(packageJson.exports)) {
          const specifier =
            subpath === '.' ? packageJson.name : packageJson.name + subpath.slice(1)
          await import(specifier)
        }

        // Exercise the output contract through installed public entrypoints and a real artifact store.
        const { strict: assert } = await import('node:assert')
        const { mkdtemp, rm } = await import('node:fs/promises')
        const { tmpdir } = await import('node:os')
        const { join } = await import('node:path')
        const kernel = await import(packageJson.name + '/kernel')
        const declaration = { paths: ['report.bin'], maxFileBytes: 1024, maxTotalBytes: 2048 }
        assert.deepEqual(kernel.validateIsolatedCheckOutputs(declaration), declaration)
        assert.throws(() => kernel.validateIsolatedCheckOutputs({ ...declaration, paths: ['../report.bin'] }))
        assert.equal(typeof kernel.runIsolatedCheck, 'function')
        const checkStore = await mkdtemp(join(tmpdir(), 'packed-check-outputs-'))
        try {
          const artifacts = kernel.createPrivateCasArtifactPort(checkStore, 'packed-check')
          const bytes = Buffer.from([0, 255, 10, 42])
          const artifact = await artifacts.put({ executionId: 'packed-check', purpose: 'grader-evidence', bytes })
          const outputs = {
            executionId: 'packed-check', inputDigest: 'sha256:' + 'a'.repeat(64), status: 'retained',
            files: [{ path: 'report.bin', artifact }], missing: [],
          }
          const success = { succeeded: true, value: { stdout: 'ok', stderr: '' }, outputs }
          const failure = {
            succeeded: false, reason: 'failed', diagnostic: 'fixture failure', exitCode: 7,
            outputs: { ...outputs, status: 'incomplete', missing: [{ path: 'missing.txt', reason: 'missing' }] },
          }
          assert.deepEqual(root.isolatedCheckResultSchema.parse(success), success)
          assert.deepEqual(root.isolatedCheckResultSchema.parse(failure), failure)
          assert.deepEqual(Buffer.from(await artifacts.read(artifact)), bytes)
        } finally {
          await rm(checkStore, { recursive: true, force: true })
        }
