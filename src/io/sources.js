// Ways to build a Pack in the browser. Nothing is uploaded: every source reads files
// lazily, on demand, straight from the user's disk or the given URL.
//
// Folders are opened through `<input webkitdirectory>` and drag and drop rather than
// the File System Access picker, which Chromium refuses for anything under Program
// Files, where Trove and most games install.
import { Pack, normalizePath } from './pack.js';
import { readZip } from '../formats/zip.js';

const PROGRESS_EVERY = 500;
const isZip = (path) => /\.zip$/i.test(path);
const plural = (n) => `${n} file${n === 1 ? '' : 's'}`;

const commonFolder = (paths) => {
  const first = paths[0] || '';
  const top = first.includes('/') ? first.split('/')[0] : '';
  return top && paths.every((p) => p.startsWith(top + '/')) ? top : '';
};

// Loose .zip files open as folders named after the archive, so a bundle dropped on its
// own, or next to other files, reads like the pack it was made from.
async function expandZips(entries) {
  const out = [];
  for (const e of entries) {
    if (!isZip(e.path)) { out.push(e); continue; }
    const prefix = normalizePath(e.path).replace(/\.zip$/i, '') + '/';
    for (const z of readZip(await (await e.blob()).arrayBuffer())) out.push({ ...z, path: prefix + z.path });
  }
  return out;
}

function packName(entries, fallbackCount) {
  if (entries.length === 1 && isZip(entries[0].path)) return normalizePath(entries[0].path).replace(/\.zip$/i, '');
  return commonFolder(entries.map((e) => normalizePath(e.path))) || plural(fallbackCount);
}

/**
 * From an `<input type="file">` selection. Folder inputs (`webkitdirectory`) carry
 * each file's path in `webkitRelativePath`; plain multi-file inputs only have names,
 * and any .zip among them is opened.
 * @param {FileList | File[]} files
 */
export async function packFromFiles(files) {
  const list = Array.from(files);
  const entries = list.map((f) => ({ path: f.webkitRelativePath || f.name, size: f.size, blob: async () => f }));
  const folder = list.some((f) => f.webkitRelativePath);
  return new Pack(folder ? entries : await expandZips(entries), { name: packName(entries, list.length) });
}

/**
 * From a drop event. Must be called synchronously inside the `drop` handler: the
 * browser revokes access to the dropped items once the event returns.
 * @param {DataTransfer} dataTransfer
 * @param {{onProgress?: (files: number) => void}} [options]
 * @returns {Promise<Pack>}
 */
export function packFromDataTransfer(dataTransfer, { onProgress } = {}) {
  const roots = [];
  const loose = [];
  for (const item of Array.from(dataTransfer.items || [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
    if (entry) roots.push(entry);
    else { const f = item.getAsFile(); if (f) loose.push(f); }
  }
  if (!roots.length && !loose.length) return packFromFiles(dataTransfer.files || []);

  return (async () => {
    const top = loose.map((f) => ({ path: f.name, size: f.size, blob: async () => f }));
    const nested = [];
    const fileOf = (fe) => new Promise((resolve, reject) => fe.file(resolve, reject));
    const walk = async (entry, prefix, into) => {
      const path = prefix + entry.name;
      if (entry.isFile) {
        into.push({ path, blob: () => fileOf(entry) });
        if (onProgress && (top.length + nested.length) % PROGRESS_EVERY === 0) onProgress(top.length + nested.length);
        return;
      }
      const reader = entry.createReader();
      // readEntries hands out directory contents in batches until it returns none
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, path + '/', nested);
      }
    };
    for (const root of roots) await walk(root, '', root.isFile ? top : nested);
    const name = roots.length === 1 && roots[0].isDirectory ? roots[0].name : packName(top, top.length + nested.length);
    return new Pack([...await expandZips(top), ...nested], { name });
  })();
}

/**
 * From a URL: a bundle (`….zip`), or a pack folder whose `index.json` lists
 * `{name, files: [{path, size}]}` with each file served at `<folder>/<path>`.
 * `npm run bundle` and `npm run index-pack` produce those.
 * @param {string} url
 */
export async function packFromUrl(url) {
  if (isZip(url.split(/[?#]/)[0])) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not download ${url} (HTTP ${res.status})`);
    const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop()).replace(/\.zip$/i, '');
    return new Pack(readZip(await res.arrayBuffer()), { name });
  }
  const root = url.endsWith('/') ? url : url + '/';
  const res = await fetch(root + 'index.json');
  if (!res.ok) throw new Error(`could not read ${root}index.json (HTTP ${res.status})`);
  let index;
  try { index = await res.json(); } catch { index = null; }
  if (!index || !Array.isArray(index.files)) throw new Error(`${root}index.json is not a pack listing`);
  const entries = index.files.map(({ path, size }) => ({
    path, size,
    blob: async () => {
      const r = await fetch(root + normalizePath(path).split('/').map(encodeURIComponent).join('/'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    },
  }));
  return new Pack(entries, { name: index.name || root });
}
