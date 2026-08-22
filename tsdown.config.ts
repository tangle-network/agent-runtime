import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    agent: 'src/agent/index.ts',
    conversation: 'src/conversation/index.ts',
    durable: 'src/durable/index.ts',
    'tool-loop': 'src/tool-loop.ts',
    intelligence: 'src/intelligence/index.ts',
    kernel: 'src/runtime/index.ts',
    graph: 'src/runtime/graph/index.ts',
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
    'tui/index': 'src/tui/index.ts',
    'tui/bin': 'src/tui/bin.ts',
  },
  format: ['esm'],
  dts: {
    compilerOptions: {
      declarationMap: false,
      ignoreDeprecations: '6.0',
      types: ['node'],
    },
  },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'node',
  fixedExtension: false,
  deps: {
    neverBundle: true,
  },
})
