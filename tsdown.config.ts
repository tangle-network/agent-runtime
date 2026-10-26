import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    agent: 'src/agent/index.ts',
    durable: 'src/durable/index.ts',
    'chat-turn': 'src/durable/chat-turn.ts',
    'tool-loop': 'src/tool-loop.ts',
    placement: 'src/placement/index.ts',
    intelligence: 'src/intelligence/index.ts',
    kernel: 'src/runtime/index.ts',
    'task-queue': 'src/runtime/task-queue.ts',
    'analyst-loop': 'src/analyst-loop/index.ts',
    profiles: 'src/profiles/index.ts',
    platform: 'src/platform/index.ts',
    'candidate-execution/index': 'src/candidate-execution/index.ts',
    testing: 'src/testing/index.ts',
    'mcp/index': 'src/mcp/index.ts',
    'mcp/bin': 'src/mcp/bin.ts',
    'mcp/memory-bin': 'src/mcp/memory-bin.ts',
    'loop-runner-bin': 'src/loop-runner-bin.ts',
    'tui/index': 'src/tui/index.ts',
    'tui/bin': 'src/tui/bin.ts',
    'workspace-store/index': 'src/workspace-store/index.ts',
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
