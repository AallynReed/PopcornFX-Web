// Ways to build a Pack in the browser. Nothing is uploaded: every source reads files
// lazily, on demand, straight from the user's disk or the given URL.
import { Pack, normalizePath } from './pack.js';

const commonFolder = (paths) => {
  const first = paths[0] || '';
  const top = first.includes('/') ? first.split('/')[0] : '';
  return top && paths.every((p) => p.startsWith(top + '/')) ? top : '';
};

/**
 * From an `<input type="file">` selection. Folder inputs (`webkitdirectory`) carry
 * each file's path in `webkitRelativePath`; plain multi-file inputs only have names.
 * @param {FileList | File[]} files
 */
export function packFromFiles(files) {
  const list = Array.from(files);
  const entries = list.map((f) => ({ path: f.webkitRelativePath || f.name, size: f.size, blob: async () => f }));
  const name = commonFolder(entries.map((e) => normalizePath(e.path))) || `${list.length} file${list.length === 1 ? '' : 's'}`;
  return new Pack(entries, { name });
}

const PROGRESS_EVERY = 500;

/**
 * From a File System Access directory handle (`showDirectoryPicker()`).
 * @param {FileSystemDirectoryHandle} dir
 * @param {{onProgress?: (files: number) => void}} [options]
 */
export async function packFromDirectoryHandle(dir, { onProgress } = {}) {
  const entries = [];
  const walk = async (handle, prefix) => {
    for await (const child of handle.values()) {
      const path = prefix + child.name;
      if (child.kind === 'directory') await walk(child, path + '/');
      else {
        entries.push({ path, blob: () => child.getFile() });
        if (onProgress && entries.length % PROGRESS_EVERY === 0) onProgress(entries.length);
      }
    }
  };
  await walk(dir, dir.name + '/');
  return new Pack(entries, { name: dir.name });
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
  if (!roots.length && !loose.length) return Promise.resolve(packFromFiles(dataTransfer.files || []));

  return (async () => {
    const entries = loose.map((f) => ({ path: f.name, size: f.size, blob: async () => f }));
    const fileOf = (fe) => new Promise((resolve, reject) => fe.file(resolve, reject));
    const walk = async (entry, prefix) => {
      const path = prefix + entry.name;
      if (entry.isFile) {
        entries.push({ path, blob: () => fileOf(entry) });
        if (onProgress && entries.length % PROGRESS_EVERY === 0) onProgress(entries.length);
        return;
      }
      const reader = entry.createReader();
      // readEntries hands out directory contents in batches until it returns none
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, path + '/');
      }
    };
    for (const root of roots) await walk(root, '');
    const name = roots.length === 1 && roots[0].isDirectory ? roots[0].name : `${entries.length} file${entries.length === 1 ? '' : 's'}`;
    return new Pack(entries, { name });
  })();
}

/**
 * From a pack published over HTTP: `<base>/index.json` lists `{name, files: [{path, size}]}`
 * and each file is served at `<base>/<path>`. `npm run index-pack` writes that listing.
 * @param {string} base URL of the folder holding index.json
 */
export async function packFromUrl(base) {
  const root = base.endsWith('/') ? base : base + '/';
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
