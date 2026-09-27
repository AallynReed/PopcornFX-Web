// Virtualized listbox of a pack's effects. Only the rows in view exist in the DOM, so
// a game-sized pack (Trove ships 9,382 effects) scrolls and filters instantly.
import { h, formatCount } from './dom.js';
import { icon } from './icons.js';

const ROW = 48;
const OVERSCAN = 6;
const THUMB_CACHE = 400;
const KEY_SELECT_DELAY = 90;   // holding an arrow key skims without opening every effect

export class EffectList {
  /**
   * @param {HTMLElement} el scroll container with role="listbox"
   * @param {{onSelect: (path: string) => void, onCount: (text: string) => void}} handlers
   */
  constructor(el, { onSelect, onCount }) {
    this.el = el;
    this.onSelect = onSelect;
    this.onCount = onCount;
    this.pack = null;
    this.items = [];
    this.filtered = [];
    this.query = '';
    this.selected = null;
    this.rows = new Map();
    this.thumbs = new Map();
    this.spacer = h('div', { class: 'list-spacer' });
    el.append(this.spacer);
    el.addEventListener('scroll', () => this.render(), { passive: true });
    new ResizeObserver(() => this.render()).observe(el);
    el.addEventListener('click', (e) => {
      const row = e.target.closest('[data-index]');
      if (row) this.choose(Number(row.dataset.index));
    });
    el.addEventListener('keydown', (e) => this.onKey(e));
  }

  setPack(pack) {
    for (const url of this.thumbs.values()) if (typeof url === 'string') URL.revokeObjectURL(url);
    this.thumbs.clear();
    this.pack = pack;
    this.items = pack ? pack.effects : [];
    this.selected = null;
    this.filter(this.query);
  }

  filter(query) {
    this.query = query;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    this.filtered = terms.length
      ? this.items.filter((e) => { const s = (e.dir + e.name).toLowerCase(); return terms.every((t) => s.includes(t)); })
      : this.items;
    this.spacer.style.height = `${this.filtered.length * ROW}px`;
    for (const row of this.rows.values()) row.remove();
    this.rows.clear();
    this.el.scrollTop = 0;
    const total = formatCount(this.items.length);
    this.onCount(!this.pack ? '' : terms.length ? `${formatCount(this.filtered.length)} of ${total}` : `${total} effect${this.items.length === 1 ? '' : 's'}`);
    const i = this.indexOf(this.selected);
    if (i >= 0) this.reveal(i);
    this.render();
  }

  indexOf(path) { return path == null ? -1 : this.filtered.findIndex((e) => e.path === path); }

  render() {
    const top = this.el.scrollTop, height = this.el.clientHeight;
    const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
    const last = Math.min(this.filtered.length, Math.ceil((top + height) / ROW) + OVERSCAN);
    for (const [i, row] of this.rows) if (i < first || i >= last) { row.remove(); this.rows.delete(i); }
    for (let i = first; i < last; i++) if (!this.rows.has(i)) this.rows.set(i, this.el.appendChild(this.row(i)));
  }

  row(i) {
    const fx = this.filtered[i];
    const selected = fx.path === this.selected;
    const thumb = h('span', { class: 'fx-thumb', html: icon('spark') });
    const row = h('div', {
      class: 'fx-row', role: 'option', id: `fx-${i}`, 'data-index': i,
      'aria-selected': selected ? 'true' : 'false', title: this.pack.relative(fx.path),
      style: `transform: translateY(${i * ROW}px)`,
    }, thumb, h('span', { class: 'fx-text' },
      h('span', { class: 'fx-name' }, fx.name.replace(/\.pkfx$/i, '')),
      fx.dir ? h('span', { class: 'fx-dir' }, fx.dir) : null));
    this.loadThumb(fx.path, thumb);
    return row;
  }

  async loadThumb(path, slot) {
    let url = this.thumbs.get(path);
    if (url === undefined) {
      const entry = this.pack.thumbnail(path);
      if (!entry) { this.thumbs.set(path, null); return; }
      const pending = entry.blob().then((b) => URL.createObjectURL(b), () => null);
      this.thumbs.set(path, pending);
      url = await pending;
      if (this.thumbs.get(path) !== pending) { if (url) URL.revokeObjectURL(url); return; }
      this.thumbs.set(path, url);
      this.trimThumbs();
    } else if (url && typeof url !== 'string') url = await url;
    if (url && slot.isConnected) slot.replaceChildren(h('img', { src: url, alt: '', decoding: 'async' }));
  }

  trimThumbs() {
    for (const [path, url] of this.thumbs) {
      if (this.thumbs.size <= THUMB_CACHE) break;
      if (typeof url !== 'string') continue;
      URL.revokeObjectURL(url);
      this.thumbs.delete(path);
    }
  }

  reveal(i) {
    const top = i * ROW, view = this.el.clientHeight;
    if (top < this.el.scrollTop) this.el.scrollTop = top;
    else if (top + ROW > this.el.scrollTop + view) this.el.scrollTop = top + ROW - view;
  }

  /** Select by path (e.g. at load), scrolling it into view. */
  select(path) {
    const i = this.indexOf(path);
    if (i >= 0) this.choose(i);
  }

  choose(i, { deferred = false } = {}) {
    const fx = this.filtered[i];
    if (!fx) return;
    this.selected = fx.path;
    for (const [k, row] of this.rows) row.setAttribute('aria-selected', k === i ? 'true' : 'false');
    this.reveal(i);
    this.render();
    this.el.setAttribute('aria-activedescendant', `fx-${i}`);
    clearTimeout(this._timer);
    if (deferred) this._timer = setTimeout(() => this.onSelect(fx.path), KEY_SELECT_DELAY);
    else this.onSelect(fx.path);
  }

  /** Move the selection by `delta` rows (arrow keys). */
  move(delta) {
    if (!this.filtered.length) return;
    const i = this.indexOf(this.selected);
    const next = i < 0 ? (delta > 0 ? 0 : this.filtered.length - 1) : Math.min(Math.max(i + delta, 0), this.filtered.length - 1);
    if (next !== i) this.choose(next, { deferred: true });
  }

  onKey(e) {
    const page = Math.max(1, Math.floor(this.el.clientHeight / ROW) - 1);
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page, Home: -Infinity, End: Infinity };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const d = moves[e.key];
    if (Math.abs(d) === Infinity) this.choose(d > 0 ? this.filtered.length - 1 : 0, { deferred: true });
    else this.move(d);
  }
}
