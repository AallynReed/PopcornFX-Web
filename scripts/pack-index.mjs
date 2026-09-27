#!/usr/bin/env node
// Lists a pack folder as {name, files: [{path, size}]}, the index.json packFromUrl reads.
// Usage: npm run index-pack -- <pack folder>   (writes <pack folder>/index.json)
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function listPack(root) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + d.name;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full, rel + '/');
      else if (d.isFile() && rel !== 'index.json') files.push({ path: rel, size: statSync(full).size });
    }
  };
  walk(root, '');
  return { name: path.basename(root), files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: npm run index-pack -- <pack folder>');
    process.exit(2);
  }
  const root = path.resolve(dir);
  const index = listPack(root);
  writeFileSync(path.join(root, 'index.json'), JSON.stringify(index));
  console.log(`Wrote ${index.files.length} entries to ${path.join(root, 'index.json')}`);
}
