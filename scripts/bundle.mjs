#!/usr/bin/env node
// Packs one effect and every file it references into a standalone .zip bundle.
// Usage: npm run bundle -- <pack folder> <effect> [output.zip]
// <effect> is a path inside the pack (Particles/fire.pkfx) or just a file name (fire).
import { openAsBlob, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listPack } from './pack-index.mjs';
import { Pack } from '../src/io/pack.js';
import { buildBundle } from '../src/io/bundle.js';

const [dir, wanted, out] = process.argv.slice(2);
if (!dir || !wanted) {
  console.error('usage: npm run bundle -- <pack folder> <effect> [output.zip]');
  process.exit(2);
}

const root = path.resolve(dir);
const { name, files } = listPack(root);
const pack = new Pack(files.map((f) => ({ path: f.path, size: f.size, blob: () => openAsBlob(path.join(root, f.path)) })), { name });

const low = wanted.replace(/\\/g, '/').toLowerCase();
const byName = low.endsWith('.pkfx') ? low.split('/').pop() : `${low.split('/').pop()}.pkfx`;
const effect = pack.effects.find((e) => pack.relative(e.path).toLowerCase() === low || e.path.toLowerCase() === low)
  || pack.effects.find((e) => e.name.toLowerCase() === byName);
if (!effect) {
  console.error(`No effect matching "${wanted}" in ${root}`);
  process.exit(1);
}

const { blob, name: zipName, missing } = await buildBundle(pack, effect.path);
const target = path.resolve(out || zipName);
writeFileSync(target, new Uint8Array(await blob.arrayBuffer()));
console.log(`Wrote ${target} (${(blob.size / 1024).toFixed(1)} KiB) for ${pack.relative(effect.path)}`);
if (missing.length) {
  console.warn(`${missing.length} referenced file${missing.length === 1 ? ' was' : 's were'} not found and are not included:`);
  for (const m of missing) console.warn(`  ${m}`);
}
