import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    agent: 'src/agent/index.ts',
    conversation: 'src/conversation/index.ts',
    intelligence: 'src/intelligence/index.ts',
    loops: 'src/runtime/index.ts', // the loop kernel + recursive atom surface (the runtime/ directory)
    'environment-provider': 'src/runtime/environment-provider.ts',
    'analyst-loop': 'src/analyst-loop/index.ts',
    knowledge: 'src/knowledge/index.ts',
    profiles: 'src/profiles/index.ts',
    platform: 'src/platform/index.ts',
    'primeintellect/index': 'src/primeintellect/index.ts',
    'candidate-execution/index': 'src/candidate-execution/index.ts',
    testing: 'src/testing/index.ts',
    'mcp/index': 'src/mcp/index.ts',
    'mcp/bin': 'src/mcp/bin.ts',
    'mcp/memory-bin': 'src/mcp/memory-bin.ts',
    'loop-runner-bin': 'src/loop-runner-bin.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
})
