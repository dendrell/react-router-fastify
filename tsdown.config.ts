import { defineConfig } from 'tsdown'

const entry = ['src/index.ts', 'src/fastify-fetch-plugin.ts']

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
