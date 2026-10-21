
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
