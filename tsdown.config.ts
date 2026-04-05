import { defineConfig } from 'tsdown'

const entry = ['src/index.ts']

export default defineConfig([
  {
    clean: true,
    entry,
    format: ['esm'],
    outDir: 'dist',
    sourcemap: true,
    dts: true,
  },
])
