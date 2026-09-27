import './styles.css';
import { Viewer } from '../viewer/viewer.js';
import { packFromFiles, packFromDataTransfer, packFromUrl } from '../io/sources.js';
import { buildBundle, bundleEffect } from '../io/bundle.js';
import { POPCORNFX_VERSION } from '../version.js';
import { demoPack } from './demo/demo.js';
import { EffectList } from './effect-list.js';
import { Inspector } from './inspector.js';
import { icon } from './icons.js';
import { formatCount } from './dom.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const narrow = window.matchMedia('(max-width: 760px)');

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

// ---- static chrome ----
$('version-chip').textContent = `PopcornFX ${POPCORNFX_VERSION}`;
$('version-chip').title = `Effects play the way PopcornFX ${POPCORNFX_VERSION} and games built on it show them`;
for (const [id, name, label] of [
  ['open-folder', 'folder', 'Open pack folder'], ['open-files', 'file', 'Open files'],
  ['empty-folder', 'folder', 'Open pack folder'], ['empty-files', 'file', 'Open files'], ['empty-demo', 'spark', 'Try the demo'],
]) $(id).innerHTML = `${icon(name)}<span>${label}</span>`;
for (const [id, name] of [
  ['toggle-sidebar', 'list'], ['show-help', 'help'], ['toggle-inspector', 'panel'], ['close-help', 'close'],
  ['restart', 'restart'], ['step', 'step'], ['ground', 'ground'], ['reset-view', 'focus'], ['snapshot', 'camera'],
]) $(id).innerHTML = icon(name);
$('search-icon').innerHTML = icon('search');

// ---- viewer ----
let viewer = null;
try {
  viewer = new Viewer($('canvas'));
} catch (e) {
  const fatal = $('fatal');
  fatal.hidden = false;
  fatal.textContent = `This browser cannot run the preview: ${e.message}. PopcornFX-Web needs WebGL 2, which current Chrome, Edge, Firefox and Safari all provide.`;
  $('empty').hidden = true;
}

const inspector = new Inspector($('inspector'), {
  onBundle: () => downloadBundle(),
  onAddFolder: () => openFolder(),
  onAddFiles: () => openFiles(),
});
const list = new EffectList($('effect-list'), {
  onSelect: (path) => openEffect(path),
  onCount: (text) => { $('list-count').textContent = text; },
});

let pack = null;
let current = null;
let shareable = false;   // the pack came from a URL, so effect links can be shared

// ---- toasts ----
let toastTimer = 0;
function toast(message, kind = 'info', ms = 4200) {
  const el = $('toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const hideToast = () => $('toast').classList.remove('show');

// ---- packs ----
const findEffect = (set, path) => {
  if (!path) return null;
  const low = path.toLowerCase(), name = low.split('/').pop();
  return set.effects.find((e) => e.path.toLowerCase() === low || set.relative(e.path).toLowerCase() === low)
    || set.effects.find((e) => e.name.toLowerCase() === name) || null;
};

/* A set with effects replaces the open one, keeping the same effect open when it is
   there too. A set of only assets (textures, atlases, meshes) is added to the open
   one instead, so missing files can be supplied after the fact. */
async function usePack(next, { preferred = null, fromUrl = false } = {}) {
  if (!viewer) return;
  if (!next.effects.length) {
    if (!pack) { toast(`No .pkfx effects found in ${next.name}.`, 'warn'); return; }
    const reopen = current;
    pack = pack.merge(next);
    viewer.setPack(pack);
    list.setPack(pack);
    if (reopen) list.select(reopen);
    toast(`Added ${formatCount(next.size)} file${next.size === 1 ? '' : 's'}.`);
    return;
  }
  const keep = current && pack ? pack.relative(current) : null;
  const want = findEffect(next, preferred) || findEffect(next, await bundleEffect(next)) || findEffect(next, keep) || next.effects[0];
  pack = next;
  shareable = fromUrl;
  viewer.setPack(pack);
  current = null;
  app.classList.add('has-pack');
  $('pack-name').textContent = pack.name;
  $('pack-name').title = pack.roots.length ? `Pack root: ${pack.roots[pack.roots.length - 1] || '/'}` : 'No popcornproject.xml; files matched by path and name';
  $('search').disabled = false;
  $('search').value = '';
  list.setPack(pack);
  list.select(want.path);
  hideToast();
}

async function loadWith(label, make, options) {
  toast(`Reading ${label}…`, 'info', 0);
  try {
    await usePack(await make(), options);
  } catch (e) {
    toast(`Could not read ${label}: ${e.message}`, 'error');
  }
}

const progress = (n) => toast(`Indexing ${formatCount(n)} files…`, 'info', 0);

$('folder-input').addEventListener('change', (e) => {
  const files = e.target.files;
  if (files.length) loadWith('folder', () => packFromFiles(files));
  e.target.value = '';
});
$('files-input').addEventListener('change', (e) => {
  const files = e.target.files;
  if (files.length) loadWith('files', () => packFromFiles(files));
  e.target.value = '';
});
const openFolder = () => $('folder-input').click();
const openFiles = () => $('files-input').click();
for (const id of ['open-folder', 'empty-folder']) $(id).addEventListener('click', openFolder);
for (const id of ['open-files', 'empty-files']) $(id).addEventListener('click', openFiles);
$('empty-demo').addEventListener('click', () => usePack(demoPack()));

async function downloadBundle() {
  if (!pack || !current) return;
  toast('Bundling…', 'info', 0);
  try {
    const { blob, name, missing } = await buildBundle(pack, current);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(missing.length
      ? `Saved ${name}. ${missing.length} referenced file${missing.length === 1 ? ' was' : 's were'} missing and not included.`
      : `Saved ${name}. It opens on its own anywhere, including by dropping it on this page.`, missing.length ? 'warn' : 'info', 6000);
  } catch (e) {
    toast(`Could not build the bundle: ${e.message}`, 'error');
  }
}

// ---- effects ----
async function openEffect(path) {
  if (!viewer || !pack) return;
  current = path;
  const name = path.split('/').pop();
  $('effect-title').textContent = name;
  $('effect-status').textContent = 'Loading…';
  if (narrow.matches) setSidebar(false);
  if (shareable) {
    const url = new URL(location.href);
    url.searchParams.set('effect', pack.relative(path));
    history.replaceState(null, '', url);
  }
  try {
    const report = await viewer.open(path);
    if (!report || current !== path) return;
    const missing = report.assets.filter((a) => !a.rule).length;
    $('effect-status').textContent = report.empty ? 'Empty effect' : missing ? `${missing} missing asset${missing === 1 ? '' : 's'}` : '';
    inspector.show(report, pack);
  } catch (e) {
    if (current !== path) return;
    $('effect-status').textContent = 'Failed to open';
    inspector.error(pack.relative(path), e.message);
  }
}

$('search').addEventListener('input', (e) => list.filter(e.target.value));
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list.move(e.key === 'ArrowDown' ? 1 : -1); }
  else if (e.key === 'Enter') { e.preventDefault(); $('effect-list').focus(); }
  else if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.target.value = ''; list.filter(''); }
});

// ---- playback ----
function syncTransport() {
  if (!viewer) return;
  const play = $('play');
  play.innerHTML = icon(viewer.playing ? 'pause' : 'play');
  const label = viewer.playing ? 'Pause (Space)' : 'Play (Space)';
  play.setAttribute('aria-label', label);
  play.title = label;
  $('ground').setAttribute('aria-pressed', String(viewer.ground));
}
const togglePlay = () => { viewer.playing ? viewer.pause() : viewer.play(); syncTransport(); };
const stepFrame = () => { viewer.pause(); viewer.step(); syncTransport(); };
const toggleGround = () => { viewer.ground = !viewer.ground; store.set('pkfx.ground', viewer.ground ? '1' : '0'); syncTransport(); };
async function saveFrame() {
  const blob = await viewer.snapshot();
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(current || 'frame').split('/').pop().replace(/\.pkfx$/i, '')}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

if (viewer) {
  viewer.ground = store.get('pkfx.ground') === '1';
  $('play').addEventListener('click', togglePlay);
  $('restart').addEventListener('click', () => viewer.restart());
  $('step').addEventListener('click', stepFrame);
  $('speed').addEventListener('change', (e) => { viewer.speed = Number(e.target.value); });
  $('ground').addEventListener('click', toggleGround);
  $('reset-view').addEventListener('click', () => viewer.resetView());
  $('snapshot').addEventListener('click', saveFrame);
  syncTransport();

  // live readouts, a few times a second rather than every frame
  setInterval(() => {
    const { alive, fps } = viewer.stats;
    $('stats').textContent = viewer.system ? `${formatCount(alive)} particles · ${Math.round(fps)} fps` : '';
    inspector.update(viewer.stats);
  }, 250);
}

// ---- panels ----
function setInspector(open) {
  app.classList.toggle('no-inspector', !open);
  $('toggle-inspector').setAttribute('aria-pressed', String(open));
  store.set('pkfx.inspector', open ? '1' : '0');
}
function setSidebar(open) {
  app.classList.toggle('sidebar-open', open);
  $('toggle-sidebar').setAttribute('aria-expanded', String(open));
}
setInspector(store.get('pkfx.inspector') !== '0' && !window.matchMedia('(max-width: 1100px)').matches);
$('toggle-inspector').addEventListener('click', () => setInspector(app.classList.contains('no-inspector')));
$('toggle-sidebar').addEventListener('click', () => setSidebar(!app.classList.contains('sidebar-open')));

const help = $('help');
$('show-help').addEventListener('click', () => help.showModal());
$('close-help').addEventListener('click', () => help.close());
help.addEventListener('click', (e) => { if (e.target === help) help.close(); });

// ---- keyboard ----
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || help.open) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
  const onButton = t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement || t instanceof HTMLElement && t.tagName === 'SUMMARY';
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const act = {
    '/': () => $('search').focus(),
    '?': () => help.showModal(),
    i: () => setInspector(app.classList.contains('no-inspector')),
    ArrowDown: () => list.move(1),
    ArrowUp: () => list.move(-1),
  }[key] || (viewer && {
    ' ': onButton ? null : togglePlay,
    r: () => viewer.restart(),
    f: () => viewer.resetView(),
    g: toggleGround,
    '.': stepFrame,
    s: saveFrame,
    b: downloadBundle,
  }[key]);
  if (!act) return;
  e.preventDefault();
  act();
});

// ---- drag and drop ----
let dragDepth = 0;
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (dragDepth++ === 0) $('drop-overlay').hidden = false; });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('drop-overlay').hidden = true;
  const pending = packFromDataTransfer(e.dataTransfer, { onProgress: progress });   // must start inside the event
  loadWith('dropped files', () => pending);
});

// console access while developing; stripped from production builds
if (import.meta.env.DEV) window.pkfx = { viewer, list, inspector, usePack, get pack() { return pack; } };

// ---- startup: ?pack=<url>&effect=<path>, or the dev server's local pack ----
const params = new URLSearchParams(location.search);
const packUrl = params.get('pack') || (import.meta.env.DEV ? '/@pack/' : null);
if (viewer && packUrl) {
  packFromUrl(packUrl).then(
    (p) => usePack(p, { preferred: params.get('effect'), fromUrl: true }),
    (e) => { if (params.get('pack')) toast(`Could not load the pack at ${packUrl}: ${e.message}`, 'error', 0); },
  );
}
