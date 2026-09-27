// Asset references inside a .pkfx: quoted paths ending in a known asset extension.

export const ASSET_EXTENSIONS = ['dds', 'png', 'tga', 'pkat', 'pkmm', 'fbx', 'pkfx', 'pkma', 'pkml', 'pkcf', 'pkan'];

const REF_RE = new RegExp(`"([^"\\n]+\\.(?:${ASSET_EXTENSIONS.join('|')}))"`, 'gi');
// object headers sit at column 0: `ClassName<ws>$LOCAL$/id`
const HEADER_RE = /^(C[A-Za-z0-9_]+)[ \t]+\$LOCAL\$/;
const ANIM_RE = /\bAnimResource\b/;

/**
 * Asset paths an effect references, deduplicated case-insensitively in file order.
 *
 * Editor-only objects (`CNEdEditor*`: backdrops, preview rooms, scale models) are
 * skipped because they are not render dependencies and do not ship with the game.
 * An `AnimResource` names a mesh, but the motion lives in the sibling `.pkan`, so that
 * path replaces it.
 * @param {string} text
 * @returns {string[]}
 */
export function extractRefs(text) {
  const seen = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const header = HEADER_RE.exec(line);
    if (header) { current = header[1]; continue; }
    if (current && current.startsWith('CNEdEditor')) continue;
    const isAnim = ANIM_RE.test(line);
    for (const m of line.matchAll(REF_RE)) {
      const ref = m[1];
      if (ref.startsWith('$LOCAL$')) continue;
      const r = isAnim ? ref.replace(/\.[^.\\/]+$/, '.pkan') : ref;
      const key = r.toLowerCase();
      if (!seen.has(key)) seen.set(key, r);
    }
  }
  return [...seen.values()];
}
