import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The package's own public subpath, resolvable from dynamically imported authored
    // modules under test (the repo does not self-link in node_modules).
    alias: {
      '@tangle-network/agent-runtime/loops': resolve(__dirname, 'src/runtime/index.ts'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', 'dist/**', 'bench/**', '**/.claude/worktrees/**'],
  },
})
