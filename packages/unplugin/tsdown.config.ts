import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/vite.ts',
    'src/rollup.ts',
    'src/rolldown.ts',
    'src/esbuild.ts',
    'src/webpack.ts',
    'src/rspack.ts',
    'src/farm.ts',
    'src/bun.ts',
  ],
  format: ['esm'],
  platform: 'node',
  fixedExtension: false,
  dts: true,
  clean: true,
  sourcemap: true,
})
