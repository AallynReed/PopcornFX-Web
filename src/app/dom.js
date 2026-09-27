/**
 * Create an element. String children become text nodes, so file-derived text is safe;
 * `html` is for static markup (icons) only.
 * @param {string} tag
 * @param {Record<string, unknown>} [attrs]
 * @param {...(Node|string|number|null|false|(Node|string)[])} children
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}

export const formatCount = (n) => n.toLocaleString('en-US');
