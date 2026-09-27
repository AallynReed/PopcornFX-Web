// The PopcornFX release this viewer reproduces. Files carry the editor build that
// saved them in their `Version = a.b.c.build;` header.
export const POPCORNFX_VERSION = '1.13.5';

/**
 * How a file's Version header relates to the targeted release.
 * - `match`: saved by a 1.13.x editor
 * - `older`: an earlier 1.x editor; the format is forward compatible and plays
 * - `newer`: a different major version (PopcornFX 2+), which this viewer cannot read
 * - `unknown`: no usable header
 * @param {string|null|undefined} version
 * @returns {'match' | 'older' | 'newer' | 'unknown'}
 */
export function versionSupport(version) {
  const m = /^(\d+)\.(\d+)/.exec(version || '');
  if (!m) return 'unknown';
  const [major, minor] = [Number(m[1]), Number(m[2])];
  const [tMajor, tMinor] = POPCORNFX_VERSION.split('.').map(Number);
  if (major !== tMajor) return major > tMajor ? 'newer' : 'older';
  if (minor === tMinor) return 'match';
  return minor < tMinor ? 'older' : 'newer';
}
