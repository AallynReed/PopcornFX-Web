// PopcornFX atlas definitions (.pkat): one "u0, v0, u1, v1" rect per line.

/**
 * @param {string} text
 * @returns {number[][]} rects normalized to [umin, vmin, umax, vmax]; a reversed rect does not flip
 */
export function parseAtlas(text) {
  const rects = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [a, b, c, d] = line.split(',').map((n) => parseFloat(n.trim()));
    if (![a, b, c, d].every(Number.isFinite)) continue;
    rects.push([Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]);
  }
  return rects;
}
