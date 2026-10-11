/**
 * A Runtime script over real, explicitly granted filesystem capabilities.
 * No Pi harness, second agent loop, VM runner choice, or provider credential.
 * Run from this repository: pnpm tsx examples/code-mode/index.ts
 *
 * An agent uses the same mechanism by selecting `codeMode: true` on its existing
 * createExecutor({backend: 'router-tools', tools, executeToolCall, ...}) config.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runCodeMode } from '../../src/runtime/code-mode'

export async function main(): Promise<void> {
  const file = resolve('package.json')
  const result = await runCodeMode(
    `
    const pkg = await tools.read_package({});
    const groups = ['dependencies', 'devDependencies', 'peerDependencies'];
    return {name: pkg.name, version: pkg.version,
      dependencyCounts: Object.fromEntries(groups.map(name => [name, Object.keys(pkg[name] ?? {}).length]))};
  `,
    {
      callId: 'runtime-package-inspection',
      tools: [
        {
          name: 'read_package',
          description: 'Read this Runtime checkout package manifest.',
          inputSchema: { type: 'object', additionalProperties: false },
          outputSchema: { type: 'object' },
          // The script cannot select another path or acquire filesystem access.
          execute: async (_args, { signal }) =>
            JSON.parse(await readFile(file, { encoding: 'utf8', signal })),
        },
      ],
    },
  )
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`)
  console.log(JSON.stringify({ result: result.value, calls: result.calls }, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
