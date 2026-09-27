#!/usr/bin/env node
// Parses, builds and simulates every .pkfx under a folder, and reports what fails.
// Usage: npm run corpus -- <folder> [--frames 120] [--json]
// Exits 1 when any file fails to parse, build or simulate.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parsePkfx } from '../src/engine/parser.js';
import { buildEffect } from '../src/engine/model.js';
import { System } from '../src/engine/sim.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const frames = Number(args[args.indexOf('--frames') + 1]) || 120;
const asJson = args.includes('--json');
if (!dir) {
  console.error('usage: npm run corpus -- <folder> [--frames 120] [--json]');
  process.exit(2);
}

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.pkfx$/i.test(e.name)) files.push(full);
  }
};
walk(path.resolve(dir));

// deterministic, so two runs over the same files report the same numbers
const seeded = (seed) => () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x80000000; };

const failures = { parse: [], build: [], simulate: [] };
const versions = new Map();
const warnings = new Map();
const unsupported = new Map();
let empty = 0, withWarnings = 0, peakTotal = 0;
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const started = performance.now();

for (const file of files) {
  const rel = path.relative(dir, file);
  const text = readFileSync(file, 'utf8');
  if (!/\S/.test(text)) { empty++; continue; }
  let doc;
  try { doc = parsePkfx(text); } catch (e) { failures.parse.push([rel, e.message]); continue; }
  bump(versions, doc.version || '(none)');
  const fileWarnings = new Set();
  const rng = seeded(0x5eed);
  let effect;
  try { effect = buildEffect(doc, rng, { warn: (m) => fileWarnings.add(m) }); } catch (e) { failures.build.push([rel, e.message]); continue; }
  for (const layer of effect.layers) {
    for (const r of layer.renderers) if (r.kind === 'unsupported') bump(unsupported, r.cls);
    const walkEv = (list) => { for (const ev of list) { if (ev.type === 'unsupported') bump(unsupported, ev.cls); if (ev.children) walkEv(ev.children); } };
    walkEv(layer.evolvers);
  }
  try {
    const sys = new System(effect, rng);
    let peak = 0;
    for (let f = 0; f < frames; f++) {
      sys.update(1 / 60);
      let alive = 0;
      for (const l of sys.layers) alive += l.count;
      if (alive > peak) peak = alive;
    }
    peakTotal += peak;
  } catch (e) { failures.simulate.push([rel, e.message]); continue; }
  if (fileWarnings.size) withWarnings++;
  for (const w of fileWarnings) bump(warnings, w.replace(/layer \S+: /, 'layer …: ').replace(/script \S+ (failed|does not)/, 'script … $1'));
}

const seconds = (performance.now() - started) / 1000;
const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);
const result = {
  folder: path.resolve(dir), files: files.length, empty, frames, seconds: Number(seconds.toFixed(1)),
  failed: { parse: failures.parse.length, build: failures.build.length, simulate: failures.simulate.length },
  filesWithWarnings: withWarnings,
  averagePeakParticles: Math.round(peakTotal / Math.max(1, files.length - empty)),
  versions: Object.fromEntries(top(versions, 50)),
  unsupported: Object.fromEntries(top(unsupported, 50)),
  topWarnings: Object.fromEntries(top(warnings, 15)),
  failures,
};

if (asJson) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`${result.files} effects in ${result.folder} (${empty} empty), ${frames} frames each, ${result.seconds}s`);
  console.log(`failed: parse ${result.failed.parse}, build ${result.failed.build}, simulate ${result.failed.simulate}`);
  console.log(`files with script warnings: ${withWarnings}; average peak particles: ${result.averagePeakParticles}`);
  console.log('\nVersion headers:');
  for (const [v, n] of top(versions, 50)) console.log(`  ${String(n).padStart(6)}  ${v}`);
  if (unsupported.size) {
    console.log('\nNot reproduced (occurrences):');
    for (const [c, n] of top(unsupported, 50)) console.log(`  ${String(n).padStart(6)}  ${c}`);
  }
  if (warnings.size) {
    console.log('\nMost common warnings:');
    for (const [w, n] of top(warnings, 15)) console.log(`  ${String(n).padStart(6)}  ${w}`);
  }
  for (const kind of ['parse', 'build', 'simulate']) {
    if (!failures[kind].length) continue;
    console.log(`\n${kind} failures:`);
    for (const [f, m] of failures[kind].slice(0, 25)) console.log(`  ${f}: ${m}`);
    if (failures[kind].length > 25) console.log(`  … and ${failures[kind].length - 25} more`);
  }
}
process.exitCode = failures.parse.length || failures.build.length || failures.simulate.length ? 1 : 0;
