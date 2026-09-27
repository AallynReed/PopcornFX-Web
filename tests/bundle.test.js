import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, readZip, writeZip } from '../src/formats/zip.js';
import { Pack } from '../src/io/pack.js';
import { BUNDLE_MANIFEST, buildBundle, bundleEffect, collectBundle } from '../src/io/bundle.js';
import { fixture } from './helpers.js';

const text = (s) => new TextEncoder().encode(s);
const entry = (path, body) => ({ path, blob: async () => new Blob([body]) });

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(text('123456789')), 0xcbf43926);
});

test('zip round trip with stored and deflated entries and UTF-8 names', async () => {
  const big = text('flame '.repeat(2000));
  const blob = await writeZip([
    { path: 'Particles/fire.pkfx', data: big },
    { path: 'Textures/ümlaut.dds', data: new Uint8Array([1, 2, 3]) },
  ]);
  assert.ok(blob.size < big.length, 'repetitive text deflates');
  const entries = readZip(await blob.arrayBuffer());
  assert.deepEqual(entries.map((e) => [e.path, e.size]), [['Particles/fire.pkfx', big.length], ['Textures/ümlaut.dds', 3]]);
  assert.deepEqual(new Uint8Array(await (await entries[0].blob()).arrayBuffer()), big);
  assert.deepEqual([...new Uint8Array(await (await entries[1].blob()).arrayBuffer())], [1, 2, 3]);
});

test('rejects data that is not a zip', () => {
  assert.throws(() => readZip(new ArrayBuffer(64)), /not a ZIP/);
});

test('a bundle holds the effect, its dependencies at their referenced paths, and a manifest', async () => {
  const pack = new Pack([
    entry('VFX/popcornproject.xml', '<PopcornProject><x/></PopcornProject>'),
    entry('VFX/Particles/parent.pkfx', fixture('events.pkfx')),
    entry('VFX/Textures/parent.dds', 'P'),          // referenced as Textures/Parent.dds
    entry('VFX/Textures/child.dds', 'C'),
    entry('VFX/Editor/Thumbnails/Particles/parent.pkfx.png', 'thumb'),
    entry('VFX/Textures/unrelated.dds', 'U'),
  ]);
  const { effect, files, missing } = await collectBundle(pack, 'VFX/Particles/parent.pkfx');
  assert.equal(effect, 'Particles/parent.pkfx');
  assert.deepEqual(files.map((f) => f.path).sort(), [
    'Editor/Thumbnails/Particles/parent.pkfx.png', 'Particles/parent.pkfx', 'Textures/Parent.dds', 'Textures/child.dds',
    'pkfx-bundle.json', 'popcornproject.xml',
  ]);
  assert.deepEqual(missing, ['AtlasDefinitions/atlasDef_2x2.pkat']);
  assert.equal(await files.find((f) => f.path === 'popcornproject.xml').blob.text(), '<PopcornProject><x/></PopcornProject>');
});

test('child effects are followed and a bundle reopens as a pack', async () => {
  const child = 'CParticleRenderer_Billboard\t$LOCAL$/R\n{\n\tDiffuse = "Textures/spark.dds";\n}\n';
  const parent = 'CParticleEffect\t$LOCAL$/Resource\n{\n\tSub = "Particles/child.pkfx";\n}\n';
  const pack = new Pack([entry('Particles/main.pkfx', parent), entry('Particles/child.pkfx', child), entry('Textures/spark.dds', 'S')]);
  const { blob, name, missing } = await buildBundle(pack, 'Particles/main.pkfx');
  assert.equal(name, 'main.zip');
  assert.deepEqual(missing, []);
  const opened = new Pack(readZip(await blob.arrayBuffer()).map((e) => ({ ...e, path: `main/${e.path}` })), { name: 'main' });
  assert.deepEqual(opened.roots, ['main/']);
  assert.equal(await bundleEffect(opened), 'main/Particles/main.pkfx');
  assert.equal(opened.resolve('Textures/spark.dds', 'main/Particles/child.pkfx').rule, 'pack');
  assert.ok(opened.resolve(BUNDLE_MANIFEST));
});

test('merging adds files without displacing existing ones', async () => {
  const merged = new Pack([entry('fx.pkfx', 'x'), entry('Textures/a.dds', 'old')], { name: 'Mine' })
    .merge(new Pack([entry('Textures/a.dds', 'new'), entry('Textures/b.dds', 'b')]));
  assert.equal(merged.name, 'Mine');
  assert.equal(await merged.text('Textures/a.dds'), 'old');
  assert.equal(await merged.text('Textures/b.dds'), 'b');
});
