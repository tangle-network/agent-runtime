import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/adapters.ts', 'src/benchmarks/*.ts'],
  format: ['esm'],
  dts: {
    compilerOptions: {
      ignoreDeprecations: '6.0',
      types: ['node'],
    },
  },
  sourcemap: true,
  clean: true,
  splitting: true,
  target: 'es2022',
})
