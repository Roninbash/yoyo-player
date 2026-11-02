// Builds the extension for each browser from src/.
//
//   node scripts/build.mjs          -> dist/chrome, dist/safari
//   node scripts/build.mjs --zip    -> also dist/yoyo-player-chrome-<version>.zip for the Chrome Web Store
//
// src/manifest.json is the Chrome manifest. Safari gets a copy with a background
// page instead of a service worker and without Chrome-only keys.
//
// The manifest's `key` pins the extension's ID while developing, so the Mac companion
// app can allow it. The Chrome Web Store assigns its own ID and rejects uploads with a
// `key`, so the store package leaves it out.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

const manifest = JSON.parse(await readFile(path.join(src, 'manifest.json'), 'utf8'));

const targets = {
  chrome: (m) => m,
  safari: (m) => {
    const { minimum_chrome_version, key, ...rest } = m;
    return {
      ...rest,
      permissions: rest.permissions.filter((p) => p !== 'nativeMessaging'),
      background: { scripts: ['send.js', 'background.js'] },
      browser_specific_settings: { safari: { strict_min_version: '16.4' } },
    };
  },
};

for (const [name, transform] of Object.entries(targets)) {
  const out = path.join(dist, name);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(src, out, { recursive: true, filter: (p) => !path.basename(p).startsWith('.') });
  await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(transform(structuredClone(manifest)), null, 2)}\n`);
  console.log(`built dist/${name}`);
}

if (process.argv.includes('--zip')) {
  const zip = path.join(dist, `yoyo-player-chrome-${manifest.version}.zip`);
  const store = path.join(dist, 'chrome-store');
  const { key, ...storeManifest } = manifest;
  await rm(zip, { force: true });
  await rm(store, { recursive: true, force: true });
  await cp(path.join(dist, 'chrome'), store, { recursive: true });
  await writeFile(path.join(store, 'manifest.json'), `${JSON.stringify(storeManifest, null, 2)}\n`);
  execFileSync('zip', ['-r', '-X', '-q', zip, '.'], { cwd: store, stdio: 'inherit' });
  console.log(`packaged ${path.relative(root, zip)}`);
}
