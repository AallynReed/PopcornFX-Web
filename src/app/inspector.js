// Side panel describing the open effect: its version header, layers with live
// particle counts, how each referenced asset resolved, and anything not reproduced.
import { h, formatCount } from './dom.js';
import { icon } from './icons.js';
import { POPCORNFX_VERSION, versionSupport } from '../version.js';

const RULE_TEXT = {
  pack: 'Found in the pack',
  path: 'Found by full path',
  name: 'Matched by file name only',
};
const SKIP_TEXT = { distortion: 'distortion is not drawn', 'no texture': 'no texture, so the game draws nothing' };

export class Inspector {
  /** @param {HTMLElement} el */
  constructor(el) {
    this.el = el;
    this.counts = [];
    this.diagnosticCount = 0;
    this.report = null;
    this.clear();
  }

  clear(message = 'Open an effect to see its layers, assets and any parts the preview cannot show.') {
    this.report = null;
    this.counts = [];
    this.el.replaceChildren(h('p', { class: 'inspector-empty' }, message));
  }

  /**
   * @param {import('../viewer/viewer.js').EffectReport} report
   * @param {import('../io/pack.js').Pack} pack
   */
  show(report, pack) {
    this.report = report;
    this.diagnosticCount = report.diagnostics.length;
    this.counts = [];
    this.el.replaceChildren(
      this.fileSection(report, pack),
      report.empty ? null : this.layerSection(report),
      this.assetSection(report),
      this.issueSection(report),
    );
  }

  /** Refresh live particle counts, and issues when the running effect reported new ones. */
  update(stats) {
    for (let i = 0; i < this.counts.length; i++) {
      const n = stats.layers[i] ?? 0;
      const cell = this.counts[i];
      const text = formatCount(n);
      if (cell.textContent !== text) cell.textContent = text;
    }
    if (this.report && this.report.diagnostics.length !== this.diagnosticCount) {
      this.diagnosticCount = this.report.diagnostics.length;
      this.el.querySelector('[data-section="issues"]')?.replaceWith(this.issueSection(this.report));
    }
  }

  fileSection(report, pack) {
    const support = versionSupport(report.version);
    const badge = {
      match: ['ok', `Matches PopcornFX ${POPCORNFX_VERSION}`],
      older: ['info', 'Older 1.x format; plays in 1.13'],
      newer: ['err', `Newer than ${POPCORNFX_VERSION}; not supported on this branch`],
      unknown: ['info', 'No version header'],
    }[report.empty ? 'unknown' : support];
    return section('Effect', 'file',
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, 'File'), h('span', { class: 'v mono', title: report.path }, pack.relative(report.path)),
        h('span', { class: 'k' }, 'Version'), h('span', { class: 'v mono' }, report.version || '—'),
        report.generator ? [h('span', { class: 'k' }, 'Saved by'), h('span', { class: 'v' }, report.generator)] : null,
      ),
      report.empty
        ? h('p', { class: 'note' }, 'This file is empty. Mods ship blank effects to switch one off, so nothing plays in game either.')
        : h('p', { class: `badge badge-${badge[0]}` }, badge[1]),
    );
  }

  layerSection(report) {
    const rows = report.layers.map((layer, i) => {
      const count = h('span', { class: 'count' }, '0');
      this.counts[i] = count;
      return h('li', { class: `layer${layer.child ? ' layer-child' : ''}` },
        h('div', { class: 'layer-head' },
          h('span', { class: 'layer-name', title: layer.child ? 'Spawned by another layer' : null }, layer.name),
          count),
        h('div', { class: 'chips' }, layer.renderers.length
          ? layer.renderers.map((r) => h('span', {
            class: `chip-sm${r.skipped || !['billboard', 'ribbon', 'mesh'].includes(r.kind) ? ' chip-muted' : ''}`,
            title: r.skipped ? SKIP_TEXT[r.skipped] : r.material ? `Material: ${r.material}` : null,
          }, r.kind))
          : h('span', { class: 'chip-sm chip-muted' }, 'no renderer')));
    });
    return section(`Layers · ${report.layers.length}`, 'layers', h('ul', { class: 'layers' }, rows));
  }

  assetSection(report) {
    if (!report.assets.length) return section('Assets', 'assets', h('p', { class: 'muted' }, 'This effect references no files.'));
    const missing = report.assets.filter((a) => !a.rule).length;
    const byName = report.assets.filter((a) => a.rule === 'name').length;
    const summary = [`${report.assets.length - missing} found`];
    if (byName) summary.push(`${byName} by name`);
    if (missing) summary.push(`${missing} missing`);
    return section('Assets', 'assets',
      h('p', { class: missing ? 'summary summary-warn' : 'summary' }, summary.join(' · ')),
      h('ul', { class: 'assets' }, report.assets.map((a) => {
        const state = !a.rule ? 'missing' : a.rule === 'name' ? 'approx' : 'ok';
        return h('li', { class: `asset asset-${state}`, title: a.rule ? `${RULE_TEXT[a.rule]}: ${a.path}` : 'Not found in the opened files' },
          h('span', { class: 'asset-icon', html: icon(state === 'missing' ? 'missing' : state === 'approx' ? 'alert' : 'check') }),
          h('span', { class: 'asset-ref mono' }, a.ref),
          h('span', { class: 'visually-hidden' }, a.rule ? RULE_TEXT[a.rule] : 'Missing'));
      })));
  }

  issueSection(report) {
    const items = [];
    for (const cls of report.unsupported) items.push(['info', `${cls} is not simulated or drawn by this viewer.`]);
    for (const layer of report.layers) {
      for (const r of layer.renderers) if (r.skipped) items.push(['info', `${layer.name}: ${SKIP_TEXT[r.skipped]}.`]);
    }
    for (const d of report.diagnostics) items.push(['warn', d]);
    const body = items.length
      ? h('ul', { class: 'issues' }, items.map(([level, text]) => h('li', { class: `issue issue-${level}` }, text)))
      : h('p', { class: 'muted' }, 'Everything in this effect is reproduced.');
    const el = section(items.length ? `Notes · ${items.length}` : 'Notes', 'issues', body);
    el.dataset.section = 'issues';
    return el;
  }

  error(path, message) {
    this.report = null;
    this.counts = [];
    this.el.replaceChildren(section('Effect', 'file',
      h('p', { class: 'mono v' }, path),
      h('p', { class: 'badge badge-err' }, 'Could not open this effect'),
      h('p', { class: 'note mono' }, message)));
  }
}

function section(title, id, ...body) {
  const headingId = `inspector-${id}`;
  return h('section', { class: 'panel-section', 'aria-labelledby': headingId },
    h('h2', { class: 'section-title', id: headingId }, title), ...body);
}
