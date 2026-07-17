import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@tangle-network\/agent-runtime$/,
        replacement: resolve(__dirname, 'src/index.ts'),
      },
      {
        find: /^@tangle-network\/agent-runtime\/loops$/,
        replacement: resolve(__dirname, 'src/runtime/index.ts'),
      },
    ],
  },
  test: {
    exclude: ['**/node_modules/**', 'dist/**', 'bench/**', '**/.claude/worktrees/**'],
  },
})
