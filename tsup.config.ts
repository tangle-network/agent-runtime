import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    platform: 'src/platform/index.ts',
    'analyst-loop': 'src/analyst-loop/index.ts',
    improvement: 'src/improvement/index.ts',
    agent: 'src/agent/index.ts',
    intelligence: 'src/intelligence/index.ts',
    runtime: 'src/runtime/index.ts',
    loops: 'src/runtime/index.ts', // back-compat alias for the renamed runtime/ — external consumers still import ./loops
    topology: 'src/topology/index.ts',
    workflow: 'src/workflow/index.ts',
    profiles: 'src/profiles/index.ts',
    audit: 'src/audit/index.ts',
    'mcp/index': 'src/mcp/index.ts',
    'mcp/bin': 'src/mcp/bin.ts',
    'loop-runner-bin': 'src/loop-runner-bin.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
})
