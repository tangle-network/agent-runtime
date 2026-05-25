import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    platform: 'src/platform/index.ts',
    'analyst-loop': 'src/analyst-loop/index.ts',
    improvement: 'src/improvement/index.ts',
    agent: 'src/agent/index.ts',
    loops: 'src/loops/index.ts',
    profiles: 'src/profiles/index.ts',
    'mcp/index': 'src/mcp/index.ts',
    'mcp/bin': 'src/mcp/bin.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
})
