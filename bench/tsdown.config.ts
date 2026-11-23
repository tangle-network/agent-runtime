import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/adapters.ts', 'src/benchmarks/*.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'node',
  fixedExtension: false,
  deps: {
    neverBundle: true,
  },
})
