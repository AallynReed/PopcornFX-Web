// Effect bundles: one effect plus every file it references, zipped in pack layout so it
// opens standalone anywhere. Each dependency is stored at the path the effect names it
// by, so inside the bundle every reference resolves exactly, however it was found.
import { extractRefs } from '../formats/refs.js';
import { writeZip } from '../formats/zip.js';
import { POPCORNFX_VERSION } from '../version.js';
import { basename, normalizePath } from './pack.js';

export const BUNDLE_MANIFEST = 'pkfx-bundle.json';
const MINIMAL_PROJECT = '<?xml version="1.0" encoding="utf-8"?>\n<PopcornProject />\n';

/**
 * Gather an effect and its dependencies, following referenced child effects.
 * @param {import('./pack.js').Pack} pack
 * @param {string} effectPath
 * @returns {Promise<{effect: string, files: {path: string, blob: Blob}[], missing: string[]}>}
 */
export async function collectBundle(pack, effectPath) {
  const effect = pack.relative(effectPath);
  const files = new Map();      // lowercase bundle path -> {path, blob}
  const missing = new Set();
  const add = (path, blob) => { const key = path.toLowerCase(); if (!files.has(key)) files.set(key, { path, blob }); };

  const queue = [{ path: effect, source: effectPath }];
  const seen = new Set();
  while (queue.length) {
    const { path, source } = queue.shift();
    if (seen.has(source.toLowerCase())) continue;
    seen.add(source.toLowerCase());
    const hit = pack.resolve(source) || pack.resolve(path);
    if (!hit) { missing.add(path); continue; }
    const blob = await hit.entry.blob();
    add(path, blob);
    for (const ref of extractRefs(await blob.text())) {
      const dep = pack.resolve(ref, hit.entry.path);
      const at = normalizePath(ref);
      if (!dep) { missing.add(at); continue; }
      if (/\.pkfx$/i.test(ref)) queue.push({ path: at, source: dep.entry.path });
      else add(at, await dep.entry.blob());
    }
  }

  const project = pack.resolve('popcornproject.xml', effectPath);
  add('popcornproject.xml', project && project.rule === 'pack' ? await project.entry.blob() : new Blob([MINIMAL_PROJECT]));
  const thumb = pack.thumbnail(effectPath);
  if (thumb) add(`Editor/Thumbnails/Particles/${basename(effect)}.png`, await thumb.blob());
  const manifest = { effect, popcornfx: POPCORNFX_VERSION, missing: [...missing] };
  add(BUNDLE_MANIFEST, new Blob([JSON.stringify(manifest, null, 2) + '\n']));

  return { effect, files: [...files.values()], missing: manifest.missing };
}

/**
 * Zip an effect and its dependencies.
 * @returns {Promise<{blob: Blob, name: string, missing: string[]}>}
 */
export async function buildBundle(pack, effectPath) {
  const { effect, files, missing } = await collectBundle(pack, effectPath);
  const entries = [];
  for (const f of files) entries.push({ path: f.path, data: new Uint8Array(await f.blob.arrayBuffer()) });
  return { blob: await writeZip(entries), name: basename(effect).replace(/\.pkfx$/i, '') + '.zip', missing };
}

/** The effect a bundle was made for, when `pack` holds a bundle manifest. */
export async function bundleEffect(pack) {
  const hit = pack.resolve(BUNDLE_MANIFEST);
  if (!hit) return null;
  try {
    const { effect } = JSON.parse(await (await hit.entry.blob()).text());
    const root = hit.entry.path.slice(0, hit.entry.path.length - BUNDLE_MANIFEST.length);
    return typeof effect === 'string' ? root + normalizePath(effect) : null;
  } catch { return null; }
}
