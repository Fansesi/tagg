import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'thunderbird-tagg');
const release = path.join(root, 'dist', 'thunderbird-tagg');
const require = createRequire(path.join(source, 'package.json'));
const { build } = require('esbuild');

await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });

await build({
  entryPoints: [path.join(source, 'background.ts'), path.join(source, 'options.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  sourcemap: false,
  outdir: release,
  entryNames: '[name]',
});

await cp(path.join(source, 'manifest.json'), path.join(release, 'manifest.json'));
await cp(path.join(source, 'options.html'), path.join(release, 'options.html'));

const hostRelease = path.join(release, 'native-host');
const pythonRelease = path.join(hostRelease, 'tagg');
await mkdir(pythonRelease, { recursive: true });
for (const filename of ['__init__.py', '__main__.py', 'core.py', 'native_protocol.py']) {
  await cp(path.join(root, 'src', 'tagg', filename), path.join(pythonRelease, filename));
}
await cp(
  path.join(source, 'native-host', 'tagg_native_host.py'),
  path.join(hostRelease, 'tagg_native_host.py'),
);
await cp(
  path.join(source, 'native-host', 'tagg_native_host'),
  path.join(hostRelease, 'tagg_native_host'),
);
await chmod(path.join(hostRelease, 'tagg_native_host'), 0o755);
await cp(
  path.join(source, 'native-host-manifest.json'),
  path.join(hostRelease, 'tagg_native_host.json'),
);

console.log(`Thunderbird release written to ${release}`);