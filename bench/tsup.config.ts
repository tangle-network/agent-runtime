import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/adapters.ts', 'src/benchmarks/*.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  target: 'es2022',
})
