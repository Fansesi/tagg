import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginSource = path.join(root, 'src', 'obsidian-tagg');
const release = path.join(root, 'dist', 'obsidian-tagg');
const require = createRequire(path.join(pluginSource, 'package.json'));
const { build } = require('esbuild');

await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });

await build({
  entryPoints: [path.join(pluginSource, 'main.ts')],
  bundle: true,
  external: ['obsidian', 'electron', 'child_process', 'fs', 'path', 'process'],
  format: 'cjs',
  target: 'es2020',
  sourcemap: false,
  treeShaking: true,
  outfile: path.join(release, 'main.js'),
});

await cp(path.join(pluginSource, 'manifest.json'), path.join(release, 'manifest.json'));
const pythonRelease = path.join(release, 'python', 'tagg');
await mkdir(pythonRelease, { recursive: true });
for (const filename of ['__init__.py', '__main__.py']) {
  await cp(path.join(root, 'src', 'tagg', filename), path.join(pythonRelease, filename));
}