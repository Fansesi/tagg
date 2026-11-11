import { build } from 'esbuild';

await build({
  entryPoints: ['background.ts', 'options.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  sourcemap: false,
  outdir: 'dist',
  entryNames: '[name]',
});