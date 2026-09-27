// A set of files an effect can reference, indexed for PopcornFX-style path lookup.
//
// PopcornFX resolves every path in an effect against its pack root, the folder that
// holds popcornproject.xml, so `Textures/fx.dds` means `<root>/Textures/fx.dds`.
// Matching is case-insensitive like the Windows filesystem the editor and games run
// on (Trove's effects name VFX_circle_10.dds, which ships as vfx_circle_10.dds).
// Files dropped without a pack fall back to a match by file name, which is also how
// mod bundles resolve; `resolve()` reports which rule matched.

/**
 * @typedef {object} PackEntry
 * @property {string} path forward-slash path within the loaded set
 * @property {number} [size] bytes, when known up front
 * @property {() => Promise<Blob>} blob reads the file
 */

/** @typedef {'pack' | 'path' | 'name'} ResolveRule */

const PROJECT_FILE = 'popcornproject.xml';
const THUMBNAIL_DIR = 'editor/thumbnails/particles/';

export const normalizePath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/{2,}/g, '/');
export const basename = (p) => normalizePath(p).split('/').pop();
const dirname = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); };

export class Pack {
  /**
   * @param {PackEntry[]} entries
   * @param {{name?: string}} [options]
   */
  constructor(entries, { name = 'Files' } = {}) {
    this.name = name;
    /** @type {PackEntry[]} */
    this.entries = entries.map((e) => ({ ...e, path: normalizePath(e.path) }));
    this._byPath = new Map();
    this._byName = new Map();
    for (const e of this.entries) {
      const low = e.path.toLowerCase();
      if (!this._byPath.has(low)) this._byPath.set(low, e);
      const bn = low.slice(low.lastIndexOf('/') + 1);
      if (!this._byName.has(bn)) this._byName.set(bn, e);
    }
    // deepest root first, so an effect binds to the nearest enclosing pack
    this.roots = this.entries
      .filter((e) => basename(e.path).toLowerCase() === PROJECT_FILE)
      .map((e) => dirname(e.path).toLowerCase())
      .sort((a, b) => b.length - a.length);
    this._effects = null;
  }

  get size() { return this.entries.length; }

  /** Every .pkfx in the set, sorted by file name. */
  get effects() {
    if (!this._effects) {
      this._effects = this.entries
        .filter((e) => /\.pkfx$/i.test(e.path))
        .map((e) => ({ path: e.path, name: basename(e.path), dir: dirname(this.relative(e.path)) }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path));
    }
    return this._effects;
  }

  /**
   * Pack root that governs `path`: lowercase with a trailing slash, '' when the project
   * file sits at the top of the set, null when the set has no project file at all.
   */
  rootFor(path) {
    if (!this.roots.length) return null;
    const low = normalizePath(path).toLowerCase();
    return this.roots.find((r) => low.startsWith(r)) ?? this.roots[this.roots.length - 1];
  }

  /** `path` relative to its pack root. */
  relative(path) {
    const p = normalizePath(path);
    const root = this.rootFor(p);
    return root && p.toLowerCase().startsWith(root) ? p.slice(root.length) : p;
  }

  /**
   * Find the file an effect reference points at.
   * @param {string} ref path as written in the effect
   * @param {string} [from] the referencing effect's path, which selects the pack root
   * @returns {{entry: PackEntry, rule: ResolveRule} | null}
   */
  resolve(ref, from = '') {
    const r = normalizePath(ref).toLowerCase();
    if (!r) return null;
    const root = this.rootFor(from || r);
    let entry = root != null && this._byPath.get(root + r);
    if (entry) return { entry, rule: 'pack' };
    entry = this._byPath.get(r);
    if (entry) return { entry, rule: 'path' };
    entry = this._byName.get(r.slice(r.lastIndexOf('/') + 1));
    return entry ? { entry, rule: 'name' } : null;
  }

  /** The editor's still of an effect, when the pack ships one. */
  thumbnail(effectPath) {
    const p = normalizePath(effectPath);
    return this._byPath.get((this.rootFor(p) ?? '') + THUMBNAIL_DIR + basename(p).toLowerCase() + '.png') ?? null;
  }

  async blob(ref, from) {
    const hit = this.resolve(ref, from);
    if (!hit) return null;
    try { return await hit.entry.blob(); } catch { return null; }
  }

  async text(ref, from) {
    const b = await this.blob(ref, from);
    return b ? b.text() : null;
  }

  async bytes(ref, from) {
    const b = await this.blob(ref, from);
    return b ? b.arrayBuffer() : null;
  }
}
